"use strict";

const debugMode = true;

const COLS = ["A", "B", "C", "D", "E"];
const ROWS = [5, 4, 3, 2, 1];
const NORMAL_MAX_ROUNDS = 15;
const ALERT_MAX_ROUNDS = 5;
const MAX_SURVEILLANCE = 2;

const DESTINATIONS = [
  { coord: "A1", name: "駅" },
  { coord: "C1", name: "研究所" },
  { coord: "E1", name: "港" },
  { coord: "A5", name: "大使館" },
  { coord: "C5", name: "銀行" },
  { coord: "E5", name: "地下施設" },
];

const SPECIALS = {
  B3: "ホテル",
  C3: "脱出地点",
  D3: "通信塔",
};

const destinationByCoord = Object.fromEntries(DESTINATIONS.map((item) => [item.coord, item]));

let state;
let selectedAction = null;
let selectedMemoCoord = null;

const el = {
  board: document.getElementById("board"),
  phaseText: document.getElementById("phaseText"),
  roundText: document.getElementById("roundText"),
  currentPlayerText: document.getElementById("currentPlayerText"),
  resultText: document.getElementById("resultText"),
  alertRemainText: document.getElementById("alertRemainText"),
  playerInfoTitle: document.getElementById("playerInfoTitle"),
  secretDestinationText: document.getElementById("secretDestinationText"),
  missionText: document.getElementById("missionText"),
  surveillanceText: document.getElementById("surveillanceText"),
  disguiseText: document.getElementById("disguiseText"),
  accuseText: document.getElementById("accuseText"),
  moveButton: document.getElementById("moveButton"),
  missionButton: document.getElementById("missionButton"),
  surveillanceButton: document.getElementById("surveillanceButton"),
  disguiseButton: document.getElementById("disguiseButton"),
  accuseButton: document.getElementById("accuseButton"),
  escapeButton: document.getElementById("escapeButton"),
  memoButton: document.getElementById("memoButton"),
  actionHint: document.getElementById("actionHint"),
  moveControls: document.getElementById("moveControls"),
  accuseControls: document.getElementById("accuseControls"),
  memoControls: document.getElementById("memoControls"),
  memoTargetText: document.getElementById("memoTargetText"),
  memoPinButtons: document.getElementById("memoPinButtons"),
  accuseSelect: document.getElementById("accuseSelect"),
  confirmAccuseButton: document.getElementById("confirmAccuseButton"),
  publicLog: document.getElementById("publicLog"),
  secretLog: document.getElementById("secretLog"),
  debugPanel: document.getElementById("debugPanel"),
  debugContent: document.getElementById("debugContent"),
  resultOverlay: document.getElementById("resultOverlay"),
  resultOverlayText: document.getElementById("resultOverlayText"),
  overlayResetButton: document.getElementById("overlayResetButton"),
  resetButton: document.getElementById("resetButton"),
};

// プレイヤーごとの非公開情報と使用回数を初期化する。
function createPlayer(id, name, position) {
  return {
    id,
    name,
    position,
    secret: randomDestination(),
    missionCompleted: false,
    dummyUsed: false,
    surveillanceUsed: 0,
    surveillanceRecovered: 0,
    surveillanceCandidates: null,
    disguiseLeft: 2,
    disguiseActive: false,
    accuseUsed: false,
    skipNext: false,
    memoPins: {},
    secretLog: [],
  };
}

function randomDestination() {
  return DESTINATIONS[Math.floor(Math.random() * DESTINATIONS.length)];
}

// 新しいゲーム状態を作り、秘密目的地を各プレイヤーの秘密ログにだけ出す。
function resetGame() {
  selectedAction = null;
  selectedMemoCoord = null;
  state = {
    phase: "normal",
    normalRound: 1,
    alertRound: 0,
    currentPlayer: 1,
    gameOver: false,
    result: "進行中",
    alertStartedBy: null,
    alertStartedByDummy: false,
    alertForced: false,
    actedThisRound: { 1: false, 2: false },
    players: {
      1: createPlayer(1, "プレイヤー1", "A3"),
      2: createPlayer(2, "プレイヤー2", "E3"),
    },
    publicLog: [],
  };

  addPublicLog("ゲーム開始。プレイヤー1はA3、プレイヤー2はE3から開始。");
  for (const player of Object.values(state.players)) {
    addSecretLog(player.id, `あなたの秘密目的地は ${formatDestination(player.secret)} です。`);
  }
  hideSubControls();
  render();
}

function currentPlayer() {
  return state.players[state.currentPlayer];
}

function opponentOf(playerId) {
  return state.players[playerId === 1 ? 2 : 1];
}

function formatDestination(destination) {
  return `${destination.coord}：${destination.name}`;
}

function surveillanceLeft(player) {
  return Math.min(MAX_SURVEILLANCE, MAX_SURVEILLANCE - player.surveillanceUsed + player.surveillanceRecovered);
}

function addPublicLog(message) {
  state.publicLog.unshift(message);
}

function addSecretLog(playerId, message) {
  state.players[playerId].secretLog.unshift(message);
}

function isDestination(coord) {
  return Boolean(destinationByCoord[coord]);
}

function coordToXY(coord) {
  const col = COLS.indexOf(coord[0]);
  const row = Number(coord.slice(1)) - 1;
  return { col, row };
}

function xyToCoord(col, row) {
  if (col < 0 || col >= 5 || row < 0 || row >= 5) return null;
  return `${COLS[col]}${row + 1}`;
}

function distanceToEscape(coord) {
  const from = coordToXY(coord);
  const to = coordToXY("C3");
  return Math.abs(from.col - to.col) + Math.abs(from.row - to.row);
}

function moveTarget(position, direction) {
  const { col, row } = coordToXY(position);
  const delta = {
    up: [0, 1],
    down: [0, -1],
    left: [-1, 0],
    right: [1, 0],
  }[direction];
  return xyToCoord(col + delta[0], row + delta[1]);
}

function directionToCoord(fromCoord, toCoord) {
  const from = coordToXY(fromCoord);
  const to = coordToXY(toCoord);
  const dc = to.col - from.col;
  const dr = to.row - from.row;
  if (dc === 0 && dr === 1) return "up";
  if (dc === 0 && dr === -1) return "down";
  if (dc === -1 && dr === 0) return "left";
  if (dc === 1 && dr === 0) return "right";
  return null;
}

function movableCoordsFor(player) {
  return ["up", "down", "left", "right"]
    .map((dir) => moveTarget(player.position, dir))
    .filter(Boolean);
}

// 任務または15ラウンド満了で警戒フェーズへ移す。
function startAlertPhase(playerId, wasDummy, forced = false) {
  if (state.phase === "alert") return false;
  state.phase = "alert";
  state.alertRound = 1;
  state.alertStartedBy = playerId;
  state.alertStartedByDummy = wasDummy;
  state.alertForced = forced;
  state.actedThisRound = { 1: false, 2: false };
  addPublicLog(forced
    ? "通常フェーズ15ラウンド終了。強制的に警戒フェーズへ移行。"
    : "警戒フェーズ開始。5ラウンド以内に脱出を目指してください。");
  return true;
}

// 行動後のターン交代、スキップ処理、ラウンド進行をまとめて扱う。
function finishTurn(options = {}) {
  const { countAction = true } = options;
  selectedAction = null;
  selectedMemoCoord = null;
  hideSubControls();
  if (state.gameOver) {
    render();
    return;
  }

  if (countAction) {
    completeTurnFor(state.currentPlayer);
    if (state.gameOver) {
      render();
      return;
    }
  }

  switchCurrentPlayer();
  processSkippedTurns();
  render();
}

function completeTurnFor(playerId) {
  state.actedThisRound[playerId] = true;
  if (state.actedThisRound[1] && state.actedThisRound[2]) {
    endRound();
  }
}

function switchCurrentPlayer() {
  state.currentPlayer = state.currentPlayer === 1 ? 2 : 1;
}

// 告発失敗で失う手番も「そのプレイヤーが行動した」としてラウンドに数える。
function processSkippedTurns() {
  let safety = 0;
  while (!state.gameOver && currentPlayer().skipNext && safety < 2) {
    const player = currentPlayer();
    player.skipNext = false;
    addPublicLog(`${player.name}は告発失敗のペナルティで手番を失った。`);
    completeTurnFor(player.id);
    if (!state.gameOver) {
      switchCurrentPlayer();
    }
    safety += 1;
  }
}

// 両プレイヤーが1回ずつ行動したら、現在フェーズのラウンドを進める。
function endRound() {
  if (state.phase === "normal") {
    if (state.normalRound >= NORMAL_MAX_ROUNDS) {
      startAlertPhase(null, false, true);
      return;
    }
    state.normalRound += 1;
    state.actedThisRound = { 1: false, 2: false };
    return;
  }

  if (state.alertRound >= ALERT_MAX_ROUNDS) {
    judgeAlertEnd();
    return;
  }
  state.alertRound += 1;
  state.actedThisRound = { 1: false, 2: false };
}

// 警戒フェーズ終了時の勝敗判定。指定順序を崩さない。
function judgeAlertEnd() {
  const p1 = state.players[1];
  const p2 = state.players[2];

  if (p1.missionCompleted && !p2.missionCompleted) {
    endGame("警戒フェーズ終了。プレイヤー1だけが任務完了しているため、プレイヤー1の勝利。");
    return;
  }
  if (!p1.missionCompleted && p2.missionCompleted) {
    endGame("警戒フェーズ終了。プレイヤー2だけが任務完了しているため、プレイヤー2の勝利。");
    return;
  }
  if (p1.missionCompleted && p2.missionCompleted) {
    const d1 = distanceToEscape(p1.position);
    const d2 = distanceToEscape(p2.position);
    if (d1 < d2) {
      endGame("警戒フェーズ終了。C3に近いプレイヤー1の勝利。");
    } else if (d2 < d1) {
      endGame("警戒フェーズ終了。C3に近いプレイヤー2の勝利。");
    } else {
      endGame("警戒フェーズ終了。両者のC3までの距離が同じため引き分け。");
    }
    return;
  }
  if (!p1.missionCompleted && !p2.missionCompleted && state.alertStartedByDummy) {
    const loser = state.alertStartedBy;
    const winner = loser === 1 ? 2 : 1;
    endGame(`警戒フェーズ終了。ダミー任務で警戒を始めたプレイヤー${loser}の敗北。プレイヤー${winner}の勝利。`);
    return;
  }

  endGame("警戒フェーズ終了。勝利条件を満たすプレイヤーがいないため引き分け。");
}

function endGame(message) {
  state.gameOver = true;
  state.result = message;
  addPublicLog(message);
}

// 通常フェーズ中にD3へ到達したら監視回数を最大2まで1回復する。
function applyCommunicationTower(player) {
  if (state.phase !== "normal" || player.position !== "D3" || surveillanceLeft(player) >= MAX_SURVEILLANCE) return;
  player.surveillanceRecovered += 1;
  addPublicLog(`${player.name}が通信塔に到達し、監視回数を1回復した。`);
  addSecretLog(player.id, `通信塔効果：監視残りが ${surveillanceLeft(player)} 回になった。`);
}

// 上下左右1マスだけ移動する。偽装中は公開ログで移動先を伏せる。
function doMove(direction) {
  const player = currentPlayer();
  const target = moveTarget(player.position, direction);
  if (!target || state.gameOver) return;

  const from = player.position;
  player.position = target;
  if (player.disguiseActive) {
    player.disguiseActive = false;
    addPublicLog(`${player.name}が偽装移動を行った。移動ログは曖昧になった。`);
    addSecretLog(player.id, `偽装移動：${from} から ${target} へ移動した。`);
  } else {
    addPublicLog(`${player.name}が ${from} から ${target} へ移動した。`);
  }

  applyCommunicationTower(player);
  finishTurn();
}

// 目的地候補で任務を実行する。本物だけ missionCompleted を true にする。
function doMission() {
  const player = currentPlayer();
  const destination = destinationByCoord[player.position];
  if (!destination || state.gameOver) return;

  const isRealMission = player.secret.coord === player.position;
  if (!isRealMission && player.dummyUsed) {
    addSecretLog(player.id, "ダミー任務はすでに1回使っています。");
    render();
    return;
  }

  if (isRealMission) {
    player.missionCompleted = true;
    addPublicLog(`${player.name}が目的地候補で任務を実行した。`);
    addSecretLog(player.id, `${formatDestination(destination)} で本物の任務を完了した。`);
  } else {
    player.dummyUsed = true;
    addPublicLog(`${player.name}が目的地候補で任務を実行した。`);
    addSecretLog(player.id, `${formatDestination(destination)} でダミー任務を実行した。任務完了にはならない。`);
  }

  const startedAlert = startAlertPhase(player.id, !isRealMission);
  finishTurn({ countAction: !startedAlert });
}

// 通常フェーズ限定。2回目の監視は1回目の候補からさらに絞る。
function doSurveillance() {
  const player = currentPlayer();
  const opponent = opponentOf(player.id);
  if (state.phase !== "normal" || surveillanceLeft(player) <= 0 || state.gameOver) return;

  const revealCount = player.surveillanceUsed === 0 ? 3 : 2;
  const choices = buildSurveillanceChoices(player, opponent.secret, revealCount);
  player.surveillanceUsed += 1;
  player.surveillanceCandidates = choices.map((item) => item.coord);
  addPublicLog(`${player.name}が監視を行った。`);
  addSecretLog(player.id, `監視結果：相手の秘密目的地は ${choices.map(formatDestination).join(" / ")} のどれか。`);
  finishTurn();
}

function buildSurveillanceChoices(player, realSecret, count) {
  const source = player.surveillanceCandidates
    ? DESTINATIONS.filter((item) => player.surveillanceCandidates.includes(item.coord))
    : DESTINATIONS;
  const others = source.filter((item) => item.coord !== realSecret.coord);
  shuffle(others);
  const result = [realSecret, ...others.slice(0, count - 1)];
  shuffle(result);
  return result;
}

function shuffle(items) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

// 偽装は行動を消費し、次の自分の移動ログだけを曖昧にする。
function doDisguise() {
  const player = currentPlayer();
  if (player.disguiseLeft <= 0 || state.gameOver) return;

  player.disguiseLeft -= 1;
  player.disguiseActive = true;
  addPublicLog(`${player.name}が偽装を行った。次の自分の移動ログが曖昧になる。`);
  addSecretLog(player.id, "偽装状態になった。次に移動したとき、公開ログでは移動先が曖昧になる。");
  finishTurn();
}

// 警戒フェーズ限定。成功なら相手の任務完了を取り消し、失敗なら次手番を失う。
function doAccuse() {
  const player = currentPlayer();
  const opponent = opponentOf(player.id);
  const accusedCoord = el.accuseSelect.value;
  if (state.phase !== "alert" || player.accuseUsed || state.gameOver) return;

  player.accuseUsed = true;
  const destination = destinationByCoord[accusedCoord];
  if (opponent.secret.coord === accusedCoord) {
    opponent.missionCompleted = false;
    addPublicLog(`${player.name}の告発成功。${opponent.name}の任務完了状態が取り消された。`);
    addSecretLog(player.id, `告発成功：相手の秘密目的地は ${formatDestination(destination)} だった。`);
    addSecretLog(opponent.id, `${player.name}に秘密目的地を当てられた。任務完了状態が false になった。`);
  } else {
    player.skipNext = true;
    addPublicLog(`${player.name}の告発失敗。次の手番を失う。`);
    addSecretLog(player.id, `告発失敗：${formatDestination(destination)} は相手の秘密目的地ではなかった。`);
  }
  finishTurn();
}

// C3でのみ脱出できる。任務未完了なら失敗ログを出してゲームは続く。
function doEscape() {
  const player = currentPlayer();
  if (player.position !== "C3" || state.gameOver) return;

  if (player.missionCompleted) {
    endGame(`${player.name}がC3で脱出に成功。${player.name}の勝利。`);
    render();
    return;
  }

  addPublicLog(`${player.name}はC3で脱出を試みたが、任務未完了のため失敗した。`);
  addSecretLog(player.id, "脱出失敗：missionCompleted が false です。");
  finishTurn();
}

function pinClassName(pin) {
  return {
    "本命？": "memo-pin-main",
    "ダミー？": "memo-pin-dummy",
    "低確率": "memo-pin-low",
    "保留": "memo-pin-hold",
  }[pin] || "memo-pin-hold";
}

function setMemoPin(pin) {
  const player = currentPlayer();
  if (!selectedMemoCoord || !isDestination(selectedMemoCoord)) return;

  if (pin === "削除") {
    if (player.memoPins[selectedMemoCoord]) {
      delete player.memoPins[selectedMemoCoord];
      addSecretLog(player.id, `${selectedMemoCoord} のメモピンを削除した。`);
    }
  } else {
    player.memoPins[selectedMemoCoord] = pin;
    addSecretLog(player.id, `${selectedMemoCoord} に「${pin}」ピンを置いた。`);
  }

  selectedMemoCoord = null;
  render();
}

function render() {
  renderStatus();
  renderBoard();
  renderPlayerInfo();
  renderActions();
  renderLogs();
  renderDebugPanel();
  renderResultOverlay();
}

function renderStatus() {
  document.body.classList.toggle("alert-phase", state.phase === "alert");
  document.body.classList.toggle("normal-phase", state.phase === "normal");
  el.phaseText.textContent = state.phase === "normal" ? "通常フェーズ" : "警戒フェーズ";
  el.roundText.textContent = state.phase === "normal"
    ? `${state.normalRound} / ${NORMAL_MAX_ROUNDS}`
    : `${state.alertRound} / ${ALERT_MAX_ROUNDS}`;
  el.currentPlayerText.textContent = currentPlayer().name;
  el.resultText.textContent = state.result;
  el.resultText.className = state.gameOver ? "success" : "";
  if (el.alertRemainText) {
    const remain = Math.max(0, ALERT_MAX_ROUNDS - state.alertRound + 1);
    el.alertRemainText.textContent = `残り${remain}ラウンド`;
  }
}

function renderBoard() {
  const player = currentPlayer();
  const movableCoords = selectedAction === "move" && !state.gameOver ? movableCoordsFor(player) : [];
  const memoMode = selectedAction === "memo" && !state.gameOver;
  el.board.innerHTML = "";
  for (const row of ROWS) {
    for (const col of COLS) {
      const coord = `${col}${row}`;
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "cell";
      cell.dataset.coord = coord;
      cell.disabled = !movableCoords.includes(coord);
      if (memoMode) cell.disabled = !isDestination(coord);
      if (isDestination(coord)) cell.classList.add("destination");
      if (SPECIALS[coord]) cell.classList.add(coord === "C3" ? "escape" : "special");
      if (player.position === coord) cell.classList.add("current-cell");
      if (movableCoords.includes(coord)) cell.classList.add("movable");
      if (memoMode && isDestination(coord)) cell.classList.add("memo-target");

      const coordLabel = document.createElement("div");
      coordLabel.className = "coord";
      coordLabel.textContent = coord;

      const place = document.createElement("div");
      place.className = "place-name";
      place.textContent = destinationByCoord[coord]?.name ?? SPECIALS[coord] ?? "路地";

      const pieces = document.createElement("div");
      pieces.className = "pieces";
      for (const boardPlayer of Object.values(state.players)) {
        if (boardPlayer.position === coord) {
          const piece = document.createElement("span");
          piece.className = `piece p${boardPlayer.id}`;
          if (boardPlayer.id === state.currentPlayer) piece.classList.add("active-piece");
          piece.textContent = `P${boardPlayer.id}`;
          pieces.appendChild(piece);
        }
      }

      const memoPin = player.memoPins[coord];
      if (memoPin) {
        const pin = document.createElement("span");
        pin.className = `memo-pin ${pinClassName(memoPin)}`;
        pin.textContent = memoPin;
        cell.appendChild(pin);
      }

      cell.append(coordLabel, place, pieces);
      el.board.appendChild(cell);
    }
  }
}

function renderPlayerInfo() {
  const player = currentPlayer();
  el.playerInfoTitle.textContent = `${player.name} 情報`;
  el.secretDestinationText.textContent = formatDestination(player.secret);
  el.missionText.textContent = player.missionCompleted ? "true" : "false";
  el.missionText.className = player.missionCompleted ? "success" : "danger";
  el.surveillanceText.textContent = `${surveillanceLeft(player)}回`;
  el.disguiseText.textContent = `${player.disguiseLeft}回${player.disguiseActive ? "（待機中）" : ""}`;
  el.accuseText.textContent = player.accuseUsed ? "使用済み" : "未使用";
}

function getActionAvailability(player) {
  const canUseActions = !state.gameOver && !player.skipNext;
  return {
    move: {
      ok: canUseActions && movableCoordsFor(player).length > 0,
      reason: state.gameOver ? "ゲーム終了" : "移動可能なマスがありません",
    },
    mission: {
      ok: canUseActions && isDestination(player.position) && (isRealMissionSquare(player) || !player.dummyUsed),
      reason: !isDestination(player.position) ? "目的地候補マスでのみ実行できます" : "ダミー任務は1回までです",
    },
    surveillance: {
      ok: canUseActions && state.phase === "normal" && surveillanceLeft(player) > 0,
      reason: state.phase !== "normal" ? "監視は通常フェーズのみです" : "監視残りが0です",
    },
    disguise: {
      ok: canUseActions && player.disguiseLeft > 0,
      reason: "偽装残りが0です",
    },
    accuse: {
      ok: canUseActions && state.phase === "alert" && !player.accuseUsed,
      reason: state.phase !== "alert" ? "告発は警戒フェーズのみです" : "告発は1回までです",
    },
    escape: {
      ok: canUseActions && player.position === "C3",
      reason: "脱出はC3でのみ実行できます",
    },
    memo: {
      ok: canUseActions,
      reason: "ゲーム終了中はメモできません",
    },
  };
}

function renderActions() {
  const player = currentPlayer();
  const availability = getActionAvailability(player);
  const actionButtons = {
    move: el.moveButton,
    mission: el.missionButton,
    surveillance: el.surveillanceButton,
    disguise: el.disguiseButton,
    accuse: el.accuseButton,
    escape: el.escapeButton,
    memo: el.memoButton,
  };

  for (const [action, button] of Object.entries(actionButtons)) {
    button.disabled = !availability[action].ok;
    button.title = availability[action].ok ? "" : availability[action].reason;
    button.classList.toggle("selected", selectedAction === action);
  }
  el.memoButton.classList.toggle("memo-on", selectedAction === "memo");
  el.memoButton.textContent = selectedAction === "memo" ? "メモモード ON" : "メモモード OFF";

  for (const button of el.moveControls.querySelectorAll("button")) {
    button.disabled = !moveTarget(player.position, button.dataset.dir) || state.gameOver;
  }

  if (state.gameOver) {
    el.actionHint.textContent = "ゲーム終了。リセットできます。";
  } else if (selectedAction === "move") {
    el.actionHint.textContent = "光っているマスをクリック";
  } else if (selectedAction === "memo") {
    el.actionHint.textContent = "目的地候補にピンを置けます";
  } else if (selectedAction === "accuse") {
    el.actionHint.textContent = "相手の目的地を宣言";
  } else {
    const disabledReasons = Object.values(availability)
      .filter((item) => !item.ok)
      .map((item) => item.reason);
    el.actionHint.textContent = disabledReasons[0] || "行動を選択";
  }

  if (el.memoTargetText) {
    el.memoTargetText.textContent = selectedMemoCoord
      ? `${selectedMemoCoord} のピンを選択`
      : "目的地候補マスを選択してください";
  }
}

function isRealMissionSquare(player) {
  return player.secret.coord === player.position;
}

function renderLogs() {
  renderLogList(el.publicLog, state.publicLog);
  renderLogList(el.secretLog, currentPlayer().secretLog);
}

function renderLogList(target, messages) {
  target.innerHTML = "";
  for (const message of messages.slice(0, 80)) {
    const item = document.createElement("li");
    item.textContent = message;
    target.appendChild(item);
  }
}

function renderDebugPanel() {
  if (!el.debugPanel || !el.debugContent) return;
  el.debugPanel.classList.toggle("hidden", !debugMode);
  if (!debugMode) return;

  const debugState = {
    phase: state.phase,
    round: state.normalRound,
    alertRound: state.alertRound,
    currentPlayer: state.currentPlayer,
    actedThisRound: state.actedThisRound,
    players: Object.fromEntries(Object.values(state.players).map((player) => [
      `player${player.id}`,
      {
        position: player.position,
        secretDestination: formatDestination(player.secret),
        missionCompleted: player.missionCompleted,
        dummyUsed: player.dummyUsed,
        surveillanceLeft: surveillanceLeft(player),
        disguiseLeft: player.disguiseLeft,
        accusationUsed: player.accuseUsed,
        skipNextTurn: player.skipNext,
        memoPins: player.memoPins,
      },
    ])),
  };
  el.debugContent.textContent = JSON.stringify(debugState, null, 2);
}

function renderResultOverlay() {
  if (!el.resultOverlay || !el.resultOverlayText) return;
  el.resultOverlay.classList.toggle("hidden", !state.gameOver);
  el.resultOverlayText.textContent = state.result;
}

function hideSubControls() {
  el.moveControls.classList.add("hidden");
  el.accuseControls.classList.add("hidden");
  el.memoControls.classList.add("hidden");
}

function fillAccuseSelect() {
  el.accuseSelect.innerHTML = "";
  for (const destination of DESTINATIONS) {
    const option = document.createElement("option");
    option.value = destination.coord;
    option.textContent = formatDestination(destination);
    el.accuseSelect.appendChild(option);
  }
}

function toggleAction(action) {
  selectedAction = selectedAction === action ? null : action;
  selectedMemoCoord = null;
  el.moveControls.classList.toggle("hidden", selectedAction !== "move");
  el.accuseControls.classList.toggle("hidden", selectedAction !== "accuse");
  el.memoControls.classList.toggle("hidden", selectedAction !== "memo");
  render();
}

el.moveButton.addEventListener("click", () => {
  if (el.moveButton.disabled) return;
  toggleAction("move");
});

el.board.addEventListener("click", (event) => {
  const cell = event.target.closest(".cell");
  if (!cell || cell.disabled) return;
  if (selectedAction === "move") {
    const direction = directionToCoord(currentPlayer().position, cell.dataset.coord);
    if (direction) doMove(direction);
  } else if (selectedAction === "memo" && isDestination(cell.dataset.coord)) {
    selectedMemoCoord = cell.dataset.coord;
    render();
  }
});

el.moveControls.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-dir]");
  if (!button || button.disabled) return;
  doMove(button.dataset.dir);
});

el.missionButton.addEventListener("click", doMission);
el.surveillanceButton.addEventListener("click", doSurveillance);
el.disguiseButton.addEventListener("click", doDisguise);
el.accuseButton.addEventListener("click", () => {
  if (el.accuseButton.disabled) return;
  toggleAction("accuse");
});
el.memoButton.addEventListener("click", () => {
  if (el.memoButton.disabled) return;
  toggleAction("memo");
});
el.memoPinButtons.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-pin]");
  if (!button) return;
  setMemoPin(button.dataset.pin);
});
el.confirmAccuseButton.addEventListener("click", doAccuse);
el.escapeButton.addEventListener("click", doEscape);
el.resetButton.addEventListener("click", resetGame);
if (el.overlayResetButton) {
  el.overlayResetButton.addEventListener("click", resetGame);
}

fillAccuseSelect();
resetGame();
