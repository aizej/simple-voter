// ============================================================
// CONFIG FOR FRONTEND
// ============================================================



const WS_URL = "ws://158.101.167.252:8001/"; // Change this to the URL and port of your backend server
// The port needs to match the port used in the backend server. If you are running the backend locally, you can use "ws://localhost:8001/"
const POOL_TEXT = "showcase_pool";  // Change this to use a different pool of ideas 
// you can chose any name for the pool
// every frontend client that connects with the same pool_text will see the same ideas and votes



// ============================================================
// END OF CONFIG 
// ============================================================










// Comparators used for sorting. Add a new key here (and a matching
// <option> in index.html) to support another sort mode later.
const SORT_COMPARATORS = {
  sum_votes: (a, b) => b.sum_votes - a.sum_votes,
  up_votes: (a, b) => b.up_votes - a.up_votes,
  down_votes: (a, b) => b.down_votes - a.down_votes,
  creation_time: (a, b) => getCreationTimestamp(b) - getCreationTimestamp(a),
};


// ============================================================
// STATE
// ============================================================

const state = {
  socket: null,
  ideas: [],       // [{ idea_id, idea_text, up_votes, down_votes, sum_votes, creation_time, user_vote }]
  sortBy: "sum_votes",
};


// ============================================================
// DOM ELEMENTS
// ============================================================

const connectionStatusEl = document.getElementById("connection-status");
const connectionStatusLabelEl = connectionStatusEl.querySelector(".status-label");
const ideaListEl = document.getElementById("idea-list");
const addIdeaFormEl = document.getElementById("add-idea-form");
const addIdeaInputEl = document.getElementById("add-idea-input");
const sortSelectEl = document.getElementById("sort-select");


// ============================================================
// CONNECTION
// ============================================================

function connectToServer() {
  state.socket = new WebSocket(WS_URL);

  state.socket.addEventListener("open", handleSocketOpen);
  state.socket.addEventListener("close", handleSocketClose);
  state.socket.addEventListener("message", handleSocketMessage);
}

function handleSocketOpen() {
  connectionStatusLabelEl.textContent = "Connected";
  connectionStatusEl.classList.add("connected");
  sendAction("join_pool");
}

function handleSocketClose() {
  connectionStatusLabelEl.textContent = "Disconnected";
  connectionStatusEl.classList.remove("connected");
}

function sendAction(action, payload = {}) {
  state.socket.send(JSON.stringify({ action, pool_text: POOL_TEXT, ...payload }));
}


// ============================================================
// RECEIVING MESSAGES
// ============================================================

function handleSocketMessage(event) {
  const message = JSON.parse(event.data);
  console.log("message: ", message);


  switch (message.action) {
    case "ideas":
      handleIdeasMessage(message);
      break;

    case "ideas_update":
      handleIdeasUpdateMessage(message);
      break;

    case "vote_update":
      handleVoteUpdateMessage(message);
      break;

    case "error":
      handleErrorMessage(message);
      break;

    default:
      console.warn("Unknown action from server:", message);
  }
}

// Full list including this user's votes. Sent on connect and in
// response to an explicit "ideas_with_user_info" request.
function handleIdeasMessage(message) {
  state.ideas = message.ideas_with_user_info;
  renderIdeas();
}

// Sent after someone adds an idea. Does NOT include user_vote, so we
// merge it into what we already know instead of overwriting state.
function handleIdeasUpdateMessage(message) {
  state.ideas = mergeIdeasKeepingUserVotes(state.ideas, message.ideas);
  renderIdeas();
}

// Sent after any user votes. Updates shared counts for everyone. The
// server includes user_vote only for the client that submitted the vote.
function handleVoteUpdateMessage(message) {
  const idea = state.ideas.find((i) => i.idea_id === message.idea_id);
  if (!idea) return;

  idea.up_votes = message.up_votes;
  idea.down_votes = message.down_votes;
  idea.sum_votes = idea.up_votes - idea.down_votes;

  if (Object.hasOwn(message, "user_vote")) {
    idea.user_vote = message.user_vote;
  }

  renderIdeas();
}

function handleErrorMessage(message) {
  console.error("Server error:", message.message);
}


// ============================================================
// STATE HELPERS
// ============================================================

function mergeIdeasKeepingUserVotes(oldIdeas, newIdeas) {
  const oldById = new Map(oldIdeas.map((idea) => [idea.idea_id, idea]));

  return newIdeas.map((idea) => ({
    ...idea,
    user_vote: oldById.get(idea.idea_id)?.user_vote ?? null,
  }));
}

function getSortedIdeas() {
  const comparator = SORT_COMPARATORS[state.sortBy];
  return [...state.ideas].sort(comparator);
}

function getCreationTimestamp(idea) {
  const timestamp = Date.parse(String(idea.creation_time).replace(" ", "T"));
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function formatCreationTime(creationTime) {
  const date = new Date(getCreationTimestamp({ creation_time: creationTime }));
  if (Number.isNaN(date.getTime())) return String(creationTime ?? "");

  const pad = (value) => String(value).padStart(2, "0");

  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${
    pad(date.getHours())
  }:${pad(date.getMinutes())}`;
}


// ============================================================
// RENDERING
// ============================================================

function renderIdeas() {
  const previousPositions = new Map(
    [...ideaListEl.children].map((row) => [row.dataset.ideaId, row.getBoundingClientRect()])
  );

  ideaListEl.innerHTML = "";
  for (const idea of getSortedIdeas()) {
    ideaListEl.appendChild(createIdeaElement(idea));
  }

  animateIdeaReorder(previousPositions);
}

function animateIdeaReorder(previousPositions) {
  for (const row of ideaListEl.children) {
    const previousPosition = previousPositions.get(row.dataset.ideaId);
    if (!previousPosition) {
      row.animate(
        [{ opacity: 0, transform: "translateY(-0.5rem)" }, { opacity: 1, transform: "translateY(0)" }],
        { duration: 280, easing: "ease-out" }
      );
      continue;
    }

    const currentPosition = row.getBoundingClientRect();
    const offsetY = previousPosition.top - currentPosition.top;
    if (offsetY !== 0) {
      row.animate(
        [{ transform: `translateY(${offsetY}px)` }, { transform: "translateY(0)" }],
        { duration: 380, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
      );
    }
  }
}

function createIdeaElement(idea) {
  const row = document.createElement("li");
  row.className = "idea-row";
  row.dataset.ideaId = idea.idea_id;

  const downvoteButton = createVoteButton("Downvote", idea.down_votes, idea.user_vote == 0, () =>
    onVoteButtonClick(idea.idea_id, false)
  );
  const upvoteButton = createVoteButton("Upvote", idea.up_votes, idea.user_vote == 1, () =>
    onVoteButtonClick(idea.idea_id, true)
  );

  const ideaContent = document.createElement("div");
  ideaContent.className = "idea-content";

  const text = document.createElement("span");
  text.className = "idea-text";
  text.textContent = idea.idea_text;

  const creationTime = document.createElement("time");
  creationTime.className = "creation-time";
  creationTime.dateTime = String(idea.creation_time ?? "");
  creationTime.textContent = `${formatCreationTime(idea.creation_time)}`;
  ideaContent.append(text, creationTime);

  const score = document.createElement("span");
  score.className = "score-count";
  score.setAttribute("aria-label", `Net score ${idea.sum_votes}`);
  score.innerHTML = `<span class="metric-label">SCORE</span><strong>${idea.sum_votes}</strong>`;

  row.append(ideaContent, downvoteButton, score, upvoteButton);
  return row;
}

function createVoteButton(label, count, isActive, onClick) {
  const button = document.createElement("button");
  button.className = "vote-button" + (isActive ? " active" : "");
  button.type = "button";
  button.setAttribute("aria-label", `${label}, ${count} votes`);
  button.innerHTML = `<span class="vote-symbol" aria-hidden="true">${label === "Upvote" ? "+" : "−"}</span><span class="vote-button-count">${count}</span>`;
  button.addEventListener("click", onClick);
  return button;
}


// ============================================================
// EVENT HANDLERS (user actions)
// ============================================================

function onVoteButtonClick(ideaId, vote) {
  sendAction("vote", { idea_id: ideaId, vote });
}

function onAddIdeaSubmit(event) {
  event.preventDefault();

  const ideaText = addIdeaInputEl.value.trim();
  if (!ideaText) return;

  sendAction("add_idea", { idea_text: ideaText });
  addIdeaInputEl.value = "";
}

function onSortChange(event) {
  state.sortBy = event.target.value;
  renderIdeas();
}


// ============================================================
// INIT
// ============================================================

function init() {
  addIdeaFormEl.addEventListener("submit", onAddIdeaSubmit);
  sortSelectEl.addEventListener("change", onSortChange);
  connectToServer();
}

init();
