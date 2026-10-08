const socket = io();

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const joinForm = document.getElementById('join-form');
const playerNameInput = document.getElementById('player-name');
const roomCodeInput = document.getElementById('room-code');
const playerCountInput = document.getElementById('player-count');

let gameState = {
  map: [],
  players: [],
  bombs: [],
  explosions: [],
  round: 1,
  winner: null,
  maxPlayers: 2
};

let currentRoomCode = '';
let keys = {};

function getMyPlayer() {
  return gameState.players.find((player) => player.id === socket.id) || null;
}

function setKeyDirection() {
  let dx = 0;
  let dy = 0;

  if (keys['w'] || keys['arrowup']) dy = -1;
  if (keys['s'] || keys['arrowdown']) dy = 1;
  if (keys['a'] || keys['arrowleft']) dx = -1;
  if (keys['d'] || keys['arrowright']) dx = 1;

  if (dx !== 0 || dy !== 0) {
    socket.emit('move', { roomCode: currentRoomCode, dir: { x: dx, y: dy } });
  }
}

setInterval(() => {
  if (currentRoomCode) {
    setKeyDirection();
  }
}, 80);

window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(key)) {
    event.preventDefault();
  }

  if (key === ' ') {
    socket.emit('placeBomb', { roomCode: currentRoomCode });
    return;
  }

  keys[key] = true;
});

window.addEventListener('keyup', (event) => {
  keys[event.key.toLowerCase()] = false;
});

joinForm.addEventListener('submit', (event) => {
  event.preventDefault();

  const name = playerNameInput.value.trim() || 'Player';
  const code = (roomCodeInput.value.trim() || 'BOMB').toUpperCase();
  const playerCount = Number(playerCountInput.value || 2);

  currentRoomCode = code;
  socket.emit('joinRoom', {
    roomCode: code,
    name,
    playerCount
  });
});

socket.on('joined', ({ roomCode }) => {
  currentRoomCode = roomCode;
  roomCodeInput.value = roomCode;
});

socket.on('roomFull', ({ code }) => {
  alert(`Room ${code} is full. Try another room or lower player count.`);
});

socket.on('state', (state) => {
  gameState = state;
});

function drawTile(x, y, value) {
  const tileSize = 40;
  const px = x * tileSize;
  const py = y * tileSize;

  if (value === 1) {
    ctx.fillStyle = '#495a6f';
    ctx.fillRect(px, py, tileSize, tileSize);
    ctx.fillStyle = '#60738a';
    ctx.fillRect(px + 5, py + 5, tileSize - 10, tileSize - 10);
    return;
  }

  if (value === 2) {
    ctx.fillStyle = '#835932';
    ctx.fillRect(px, py, tileSize, tileSize);
    ctx.fillStyle = '#c58c48';
    ctx.fillRect(px + 5, py + 5, tileSize - 10, tileSize - 10);
    return;
  }

  ctx.fillStyle = '#142233';
  ctx.fillRect(px, py, tileSize, tileSize);
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.strokeRect(px, py, tileSize, tileSize);
}

function drawPlayer(player) {
  const tileSize = 40;
  const px = player.x * tileSize + tileSize / 2;
  const py = player.y * tileSize + tileSize / 2;

  if (!player.alive) return;

  ctx.beginPath();
  ctx.fillStyle = player.color;
  ctx.arc(px, py, 14, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.fillStyle = '#ffffff';
  const dx = player.direction === 'right' ? 1 : player.direction === 'left' ? -1 : 0;
  const dy = player.direction === 'down' ? 1 : player.direction === 'up' ? -1 : 0;
  ctx.moveTo(px, py);
  ctx.lineTo(px + dx * 16, py + dy * 16);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.fillStyle = '#edf2ff';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(player.name, px, py - 20);
}

function drawBomb(bomb) {
  const tileSize = 40;
  const px = bomb.x * tileSize + tileSize / 2;
  const py = bomb.y * tileSize + tileSize / 2;
  const t = Math.max(0, (bomb.explodeAt - Date.now()) / 2000);

  ctx.beginPath();
  ctx.fillStyle = '#ff5d5d';
  ctx.arc(px, py, 12, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.strokeStyle = '#ffd166';
  ctx.lineWidth = 3;
  ctx.arc(px, py, 18, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * (1 - t)));
  ctx.stroke();
}

function drawExplosion(explosion) {
  for (const cell of explosion.cells) {
    const tileSize = 40;
    const px = cell.x * tileSize + tileSize / 2;
    const py = cell.y * tileSize + tileSize / 2;

    ctx.beginPath();
    const grad = ctx.createRadialGradient(px, py, 4, px, py, 22);
    grad.addColorStop(0, 'rgba(255, 214, 102, 1)');
    grad.addColorStop(0.25, 'rgba(255, 140, 66, 0.95)');
    grad.addColorStop(1, 'rgba(255, 88, 40, 0)');
    ctx.fillStyle = grad;
    ctx.arc(px, py, 22, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawHud() {
  const myPlayer = getMyPlayer();
  const alive = gameState.players.filter((player) => player.alive).length;

  ctx.fillStyle = 'rgba(10, 16, 24, 0.68)';
  ctx.fillRect(10, 10, 260, 78);
  ctx.fillStyle = '#edf2ff';
  ctx.font = '16px sans-serif';
  ctx.fillText(`Room: ${gameState.code || currentRoomCode || 'BOMB'}`, 20, 32);
  ctx.fillText(`Alive: ${alive}/${gameState.maxPlayers}`, 20, 54);
  ctx.fillText(`Round: ${gameState.round}`, 20, 76);

  if (gameState.winner) {
    ctx.fillStyle = 'rgba(0,0,0,0.58)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = 'bold 34px sans-serif';
    ctx.fillText(`${gameState.winner} wins!`, canvas.width / 2, canvas.height / 2 - 10);
    ctx.font = '18px sans-serif';
    ctx.fillText('Next round soon...', canvas.width / 2, canvas.height / 2 + 28);
  }

  if (myPlayer) {
    ctx.fillStyle = 'rgba(10, 16, 24, 0.68)';
    ctx.fillRect(canvas.width - 220, 10, 200, 78);
    ctx.fillStyle = '#edf2ff';
    ctx.fillText(`You: ${myPlayer.name}`, canvas.width - 210, 32);
    ctx.fillText(`Score: ${myPlayer.points}`, canvas.width - 210, 54);
    ctx.fillText(`Radius: ${myPlayer.radius}`, canvas.width - 210, 76);
  }
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const map = gameState.map || [];
  const tileSize = 40;
  const renderWidth = map[0]?.length || 0;
  const renderHeight = map.length || 0;

  ctx.fillStyle = '#0d1725';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let y = 0; y < renderHeight; y++) {
    for (let x = 0; x < renderWidth; x++) {
      drawTile(x, y, map[y][x]);
    }
  }

  for (const explosion of gameState.explosions || []) {
    drawExplosion(explosion);
  }

  for (const bomb of gameState.bombs || []) {
    drawBomb(bomb);
  }

  for (const player of gameState.players || []) {
    drawPlayer(player);
  }

  drawHud();

  if (!gameState.players || gameState.players.length === 0) {
    ctx.fillStyle = '#ffffff';
    ctx.font = '22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Join a room to start', canvas.width / 2, canvas.height / 2);
  }

  requestAnimationFrame(render);
}

requestAnimationFrame(render);
