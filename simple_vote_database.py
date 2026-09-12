# %%
"""
Simple Vote Database setup:

1) Chose a name for your database file, e.g. "simple_vote_database.db" and set it in the variable DATABASE_FILE below.

2) Chose a port for the database websocket and put it in the variable PORT below. Make sure the port is not already in use.
   Dont forget to change the port in the frontend/app.js file as well.

3) Chose how you want to generate the user_id and change it in websocket_handler() function. You can use cookies or other methods.
   The current user_id is the ip address of the client. (Each user gets one vote per idea)

4) Run this script. The database file will be creted and the websocket server will start.
   You can now open the frontend/index.html file in your browser and start voting.

5) Configure the frontend in app.js file. You can change the pool_text to use a different pool of ideas.
   All clients that connect with the same pool_text will see the same ideas and votes.

6) Open the frontend/index.html file in your browser and start voting.
"""

# %%
import asyncio
import json
import sqlite3
import websockets
from collections import defaultdict

# %%


DATABASE_NAME = "simple_vote_database.db"

HOST = "0.0.0.0"
PORT = 8001






# %%
# All currently connected WebSocket clients
connected_clients = set()

# %%
# ============================================================
# Database functions
# ============================================================

def get_connection():
    conn = sqlite3.connect(DATABASE_NAME)

    # Foreign keys are disabled by default in SQLite.
    conn.execute("PRAGMA foreign_keys = ON")

    return conn

def create_votes_table():
    with get_connection() as conn:
        conn.execute(f'''CREATE TABLE IF NOT EXISTS votes_table (
                        user_id INTEGER NOT NULL,
                        idea_id INTEGER NOT NULL,
                        pool_text TEXT NOT NULL,
                        vote INTEGER NOT NULL CHECK (vote IN (0, 1)),
                        

                        PRIMARY KEY (idea_id, user_id),
                        FOREIGN KEY (idea_id) REFERENCES ideas_table(idea_id)
                        
                    )''')  #vote is a boolean value, True for yes False for no
        conn.commit()

def create_ideas_table():
    with get_connection() as conn:
        conn.execute('''CREATE TABLE IF NOT EXISTS ideas_table (
                    idea_id INTEGER PRIMARY KEY,
                    idea_text TEXT NOT NULL,
                    pool_text TEXT NOT NULL,

                    up_votes INTEGER NOT NULL DEFAULT 0,
                    down_votes INTEGER NOT NULL DEFAULT 0,
                    sum_votes INTEGER NOT NULL DEFAULT 0,
                    creation_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,



                    
                    UNIQUE (idea_text, pool_text)
                )''')
        conn.commit()

def apply_settings():
    with get_connection() as conn:
        conn.execute('PRAGMA foreign_keys = ON;')
        conn.commit()

def create_triggers():
    with get_connection() as conn:
        c = conn.cursor()
        c.execute('''
            CREATE TRIGGER IF NOT EXISTS vote_deleted
            AFTER DELETE ON votes_table
            BEGIN
                UPDATE ideas_table
                SET up_votes = up_votes -
                    CASE WHEN OLD.vote = 1 THEN 1 ELSE 0 END,
                    down_votes = down_votes -
                    CASE WHEN OLD.vote = 0 THEN 1 ELSE 0 END,
                    sum_votes = sum_votes -
                    CASE WHEN OLD.vote = 1 THEN 1 WHEN OLD.vote = 0 THEN -1 ELSE 0 END
                WHERE idea_id = OLD.idea_id;
            END;
        ''')

        c.execute('''
            CREATE TRIGGER IF NOT EXISTS vote_inserted
            AFTER INSERT ON votes_table
            BEGIN
                UPDATE ideas_table
                SET up_votes = up_votes +
                    CASE WHEN NEW.vote = 1 THEN 1 ELSE 0 END,
                    down_votes = down_votes +
                    CASE WHEN NEW.vote = 0 THEN 1 ELSE 0 END,
                    sum_votes = sum_votes +
                    CASE WHEN NEW.vote = 1 THEN 1 WHEN NEW.vote = 0 THEN -1 ELSE 0 END
                WHERE idea_id = NEW.idea_id;
            END;
        ''')


        c.execute('''
        CREATE TRIGGER IF NOT EXISTS vote_updated
            AFTER UPDATE OF vote ON votes_table
                BEGIN
                    UPDATE ideas_table
                    SET up_votes = up_votes +
                            CASE
                                WHEN NEW.vote = 0 THEN -1
                                WHEN NEW.vote = 1 THEN 1
                                ELSE 0
                            END,
                        down_votes = down_votes +
                            CASE
                                WHEN NEW.vote = 0 THEN 1
                                WHEN NEW.vote = 1 THEN -1
                                ELSE 0
                            END,
                        sum_votes = sum_votes +
                            CASE
                                WHEN NEW.vote = 0 THEN -2
                                WHEN NEW.vote = 1 THEN 2
                                ELSE 0
                            END
                    WHERE idea_id = NEW.idea_id;
                END;
        ''')

        c.execute('''
                CREATE TRIGGER IF NOT EXISTS idea_deleted
                AFTER DELETE ON ideas_table
                BEGIN
                    DELETE FROM votes_table WHERE idea_id = OLD.idea_id;
                END;
                ''')



        conn.commit()

def start_database():
    create_ideas_table()
    create_votes_table()
    apply_settings()
    create_triggers()



def insert_vote(user_id, idea_id, pool_text, vote):
    with get_connection() as conn:
        c = conn.cursor()
        c.execute('''INSERT INTO votes_table (user_id, idea_id, pool_text, vote)
                     VALUES (?, ?, ?, ?)''', (user_id, idea_id, pool_text, vote))
        conn.commit()

def remove_vote(user_id, idea_id):
    with get_connection() as conn:
        c = conn.cursor()
        c.execute('''DELETE FROM votes_table
                     WHERE user_id = ? AND idea_id = ?''', (user_id, idea_id))
        conn.commit()

def update_vote(user_id, idea_id, pool_text, vote):    
    with get_connection() as conn:
        c = conn.cursor()
        c.execute('''UPDATE votes_table
                     SET vote = ?
                     WHERE user_id = ? AND idea_id = ? AND pool_text = ?''', (vote, user_id, idea_id, pool_text))
        conn.commit()

def process_vote(user_id, idea_id, pool_text, vote):
    with get_connection() as conn:
        c = conn.cursor()
        c.execute('''SELECT vote FROM votes_table
                     WHERE user_id = ? AND idea_id = ? AND pool_text = ?''', (user_id, idea_id, pool_text))
    result = c.fetchone()

    if result is None:
        insert_vote(user_id, idea_id, pool_text, vote)
    else:
        old_vote = result[0]
        if old_vote == vote:
            remove_vote(user_id, idea_id)
        else:
            update_vote(user_id, idea_id, pool_text, vote)

def insert_idea(idea_text, pool_text):
    with get_connection() as conn:
        c = conn.cursor()
        c.execute('''INSERT INTO ideas_table (idea_text, pool_text)
                     VALUES (?, ?)''', (idea_text, pool_text))
        conn.commit()

def remove_idea(idea_id):
    with get_connection() as conn:
        c = conn.cursor()
        c.execute('''DELETE FROM ideas_table
                     WHERE idea_id = ?''', (idea_id))
        conn.commit()


def get_idea_votes(idea_id):
    with get_connection() as conn:
        c = conn.cursor()
        c.execute('''SELECT up_votes, down_votes, sum_votes FROM ideas_table
                     WHERE idea_id = ?''', (idea_id,))
        result = c.fetchone()
    if result:
        return {"up_votes": result[0], "down_votes": result[1], "sum_votes": result[2]}
    else:
        return None

def get_all_ideas_of_pool(pool_text):
    with get_connection() as conn:
        c = conn.cursor()
        c.execute('''SELECT idea_id, idea_text, up_votes, down_votes, sum_votes, creation_time FROM ideas_table
                     WHERE pool_text = ?''', (pool_text,))
    #return as a list of dictionaries
    
    ideas = []
    for row in c.fetchall():
        ideas.append({
            "idea_id": row[0],
            "idea_text": row[1],
            "up_votes": row[2],
            "down_votes": row[3],
            "sum_votes": row[4],
            "creation_time": row[5]
        })
    return ideas

def get_user_votes(user_id, pool_text):
    with get_connection() as conn:
        c = conn.cursor()
        c.execute('''SELECT idea_id, vote FROM votes_table
                     WHERE user_id = ? AND pool_text = ?''', (user_id, pool_text))
    votes = {}
    for row in c.fetchall():
        votes[row[0]] = row[1]
    return votes


def get_pool_ideas_with_user_vote(user_id, pool_text):
    ideas = get_all_ideas_of_pool(pool_text)
    user_votes = get_user_votes(user_id, pool_text)
    for idea in ideas:
        idea_id = idea["idea_id"]
        idea["user_vote"] = user_votes.get(idea_id, None)
    return ideas




# %%
# ============================================================
# WEBSOCKET
# ============================================================


#Change this function to get user_id from cookies, tokens, or any other method you prefer. The current implementation uses the client's IP address.
def ip_to_user_id(ip: str) -> str:
    """192.168.1.5 -> 192168001005"""
    return "".join(octet.zfill(3) for octet in ip.split("."))






# pool_text -> set of websockets currently viewing that pool
pool_clients = defaultdict(set)

# websocket -> pool_text it's currently viewing (so we know where to remove it from)
client_pool = {}

def join_pool(websocket, pool_text):
    leave_pool(websocket)  # in case the client switches pools without reconnecting
    pool_clients[pool_text].add(websocket)
    client_pool[websocket] = pool_text

def leave_pool(websocket):
    old_pool = client_pool.pop(websocket, None)
    if old_pool is not None:
        pool_clients[old_pool].discard(websocket)

async def broadcast_to_pool(pool_text, data, exclude=None):
    recipients = [c for c in pool_clients.get(pool_text, set()) if c is not exclude]
    if not recipients:
        return
    message = json.dumps(data)
    await asyncio.gather(
        *[client.send(message) for client in recipients],
        return_exceptions=True
    )


async def send_json(websocket, data):

    await websocket.send(
        json.dumps(data)
    )

async def websocket_handler(websocket):

    user_id = ip_to_user_id(websocket.remote_address[0])

    connected_clients.add(websocket)

    print(
        f"Client connected "
        f"({len(connected_clients)} connected)"
    )

    try:


        async for message in websocket:

            try:

                data = json.loads(message)

                print("Received:", data)


                # =================================================
                # JOIN POOL
                # =================================================

                if data.get("action") == "join_pool":

                    pool_text = data["pool_text"]

                    join_pool(websocket, pool_text)

                    await send_json(
                        websocket,
                        {
                            "action": "ideas",
                            "ideas_with_user_info": get_pool_ideas_with_user_vote(user_id, pool_text)
                        }
                    )


                # =================================================
                # VOTE
                # =================================================

                elif data.get("action") == "vote":

                    idea_id = data["idea_id"]
                    pool_text = data["pool_text"]
                    vote = data["vote"]


                    process_vote(
                        user_id,
                        idea_id,
                        pool_text,
                        vote
                    )


                    votes = get_idea_votes(
                        idea_id
                    )


                    if votes is None:

                        await send_json(
                            websocket,
                            {
                                "action": "error",
                                "message": "Idea does not exist"
                            }
                        )

                        continue


                    # Send shared counts to everyone else in the pool.
                    vote_update = {
                        "action": "vote_update",
                        "idea_id": idea_id,
                        **votes
                    }


                    await broadcast_to_pool(pool_text, vote_update, exclude=websocket)

                    # Send the authoritative personal vote to the voter.
                    user_vote = next(
                        (
                            idea["user_vote"]
                            for idea in get_pool_ideas_with_user_vote(user_id, pool_text)
                            if idea["idea_id"] == idea_id
                        ),
                        None
                    )
                    await send_json(
                        websocket,
                        {
                            **vote_update,
                            "user_vote": user_vote
                        }
                    )


                # =================================================
                # GET ALL IDEAS WITH USER INFO
                # =================================================

                elif data.get("action") == "ideas_with_user_info":

                    pool_text = data["pool_text"]

                    await send_json(
                        websocket,
                        {
                            "action": "ideas",
                            "ideas_with_user_info": get_pool_ideas_with_user_vote(user_id, pool_text)
                        }
                    )

                # =================================================
                # ADD IDEA
                # =================================================

                elif data.get("action") == "add_idea":
                    idea_text = data["idea_text"]
                    pool_text = data["pool_text"]

                    insert_idea(idea_text, pool_text)

                    # Send updated ideas to everyone in the pool.
                    await broadcast_to_pool(
                        pool_text,
                        {
                            "action": "ideas_update",
                            "ideas": get_all_ideas_of_pool(pool_text)
                        }
                    )

                # =================================================
                # UNKNOWN ACTION
                # =================================================

                else:

                    await send_json(
                        websocket,
                        {
                            "action": "error",
                            "message": "Unknown action"
                        }
                    )


            except (json.JSONDecodeError, KeyError, TypeError, ValueError) as error:

                await send_json(
                    websocket,
                    {
                        "action": "error",
                        "message": str(error)
                    }
                )


            except sqlite3.IntegrityError as error:

                await send_json(
                    websocket,
                    {
                        "action": "error",
                        "message": str(error)
                    }
                )


    except websockets.exceptions.ConnectionClosed:

        pass


    finally:

        connected_clients.discard(websocket)
        leave_pool(websocket)

        print(
            f"Client disconnected "
            f"({len(connected_clients)} connected)"
        )

# %%
# ============================================================
# SERVER
# ============================================================

async def main():

    start_database()


    async with websockets.serve(
        websocket_handler,
        HOST,
        PORT
    ):

        print(
            f"WebSocket server running on "
            f"ws://{HOST}:{PORT}"
        )

        # Keep server alive forever
        await asyncio.Future()



# %%
if __name__ == "__main__":

    asyncio.run(main())


