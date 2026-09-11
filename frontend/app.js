// ============================================================
// CONFIG
// ============================================================

const WS_URL = "ws://localhost:8001";

// Comparators used for sorting. Add a new key here (and a matching
// <option> in index.html) to support another sort mode later.
const SORT_COMPARATORS = {
  sum_votes: (a, b) => b.sum_votes - a.sum_votes,
  up_votes: (a, b) => b.up_votes - a.up_votes,
  down_votes: (a, b) => b.down_votes - a.down_votes,
};


// ============================================================
// STATE
// ============================================================

const state = {
  socket: null,
  ideas: [],       // [{ idea_id, idea_text, up_votes, down_votes, sum_votes, user_vote }]
  sortBy: "sum_votes",
};


// ============================================================
// DOM ELEMENTS
// ============================================================

const connectionStatusEl = document.getElementById("connection-status");
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
  connectionStatusEl.textContent = "Connected";
}

function handleSocketClose() {
  connectionStatusEl.textContent = "Disconnected";
}

function sendAction(action, payload = {}) {
  state.socket.send(JSON.stringify({ action, ...payload }));
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


// ============================================================
// RENDERING
// ============================================================

function renderIdeas() {
  ideaListEl.innerHTML = "";
  for (const idea of getSortedIdeas()) {
    ideaListEl.appendChild(createIdeaElement(idea));
  }
}

function createIdeaElement(idea) {
  const row = document.createElement("li");
  row.className = "idea-row";

  const upvoteButton = createVoteButton("▲", idea.user_vote == 1, () =>
    onVoteButtonClick(idea.idea_id, true)
  );
  const downvoteButton = createVoteButton("▼", idea.user_vote == 0, () =>
    onVoteButtonClick(idea.idea_id, false)
  );


  
  

  const text = document.createElement("span");
  text.className = "idea-text";
  text.textContent = idea.idea_text;

  const score = document.createElement("span");
  score.className = "vote-count";
  score.textContent = idea.sum_votes;

  const up_votes = document.createElement("span");
  up_votes.className = "vote-count";
  up_votes.textContent = "↑" + idea.up_votes;

  const down_votes = document.createElement("span");
  down_votes.className = "vote-count";
  down_votes.textContent = "↓" + idea.down_votes;

  row.append(text, upvoteButton, up_votes, down_votes, score, downvoteButton);
  return row;
}

function createVoteButton(label, isActive, onClick) {
  const button = document.createElement("button");
  button.className = "vote-button" + (isActive ? " active" : "");
  button.textContent = label;
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
