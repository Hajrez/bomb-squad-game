const socket = io();
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const hudElement = document.getElementById('hud');
const joinForm = document.getElementById('join-form');

let gameState = {
  map: [],
  players: [],
  bombs: [],
  explosions: [],
  flags: { blue: { x: 0, y: 0 }, red: { x: 0, y: 0 } },
  scores: { blue: 0, red: 0 }
};

let currentRoomCode = '';
let myTeam = 'blue';
let keys = {};
const TILE_SIZE = 48;

function getMyPlayer() {
  return gameState.players.find(p => p.id === socket.id);
}

window.addEventListener('keydown', (e) => {
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'f'].includes(e.key.toLowerCase())) {
    e.preventDefault();
    keys[e.key.toLowerCase()] = true;
    
    if (e.key === ' ') {
      socket.emit('bomb', { roomCode: currentRoomCode });
    }
    if (e.key.toLowerCase() === 'f') {
      socket.emit('flagCapture', { roomCode: currentRoomCode });
    }
  }
});

window.addEventListener('keyup', (e) => {
  keys[e.key.toLowerCase()] = false;
});

setInterval(() => {
  if (!currentRoomCode) return;
  let dx = 0, dy = 0;
  if (keys['w'] || keys['arrowup']) dy = -1;
  if (keys['s'] || keys['arrowdown']) dy = 1;
  if (keys['a'] || keys['arrowleft']) dx = -1;
  if (keys['d'] || keys['arrowright']) dx = 1;
  if (dx || dy) socket.emit('move', { roomCode: currentRoomCode, dx, dy });
}, 80);

joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = document.getElementById('player-name').value || 'Player';
  const code = (document.getElementById('room-code').value || 'ARENA').toUpperCase();
  myTeam = document.getElementById('team-select').value || 'blue';
  currentRoomCode = code;
  socket.emit('joinRoom', { code, name, team: myTeam });
});

socket.on('joined', ({ roomCode, team }) => {
  currentRoomCode = roomCode;
  myTeam = team;
});

socket.on('state', (state) => {
  gameState = state;
});

socket.on('captured', ({ team }) => {
  console.log(`🎉 ${team.toUpperCase()} team captured the flag!`);
});

function drawIsometricTile(x, y, type, offsetX, offsetY) {
  const iso_x = (x - y) * (TILE_SIZE / 2) + offsetX;
  const iso_y = (x + y) * (TILE_SIZE / 4) + offsetY;
  
  if (type === 0) {
    ctx.fillStyle = '#1e3a5f';
    ctx.fillRect(iso_x, iso_y, TILE_SIZE, TILE_SIZE / 2);
  } else if (type === 1) {
    ctx.fillStyle = '#2d5a8c';
    ctx.fillRect(iso_x, iso_y, TILE_SIZE, TILE_SIZE / 2);
    ctx.fillStyle = '#1e3a5f';
    ctx.fillRect(iso_x + 4, iso_y + 4, TILE_SIZE - 8, TILE_SIZE / 2 - 8);
  } else if (type === 2) {
    ctx.fillStyle = '#8b6914';
    ctx.fillRect(iso_x, iso_y, TILE_SIZE, TILE_SIZE / 2);
    ctx.fillStyle = '#b8860b';
    ctx.fillRect(iso_x + 4, iso_y + 4, TILE_SIZE - 8, TILE_SIZE / 2 - 8);
  }
}

function drawPlayer(player, offsetX, offsetY) {
  const iso_x = (player.x - player.y) * (TILE_SIZE / 2) + offsetX + TILE_SIZE / 2;
  const iso_y = (player.x + player.y) * (TILE_SIZE / 4) + offsetY + TILE_SIZE / 4;
  
  if (!player.alive) return;
  
  const color = player.team === 'blue' ? '#3b82f6' : '#ef4444';
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(iso_x, iso_y - 8, 12, 0, Math.PI * 2);
  ctx.fill();
  
  if (player.hasFlag) {
    ctx.fillStyle = player.team === 'blue' ? '#fbbf24' : '#a78bfa';
    ctx.fillRect(iso_x + 10, iso_y - 16, 8, 12);
  }
  
  ctx.fillStyle = '#fff';
  ctx.font = '11px bold';
  ctx.textAlign = 'center';
  ctx.fillText(player.name.slice(0, 8), iso_x, iso_y + 16);
}

function drawBomb(bomb, offsetX, offsetY) {
  const iso_x = (bomb.x - bomb.y) * (TILE_SIZE / 2) + offsetX + TILE_SIZE / 2;
  const iso_y = (bomb.x + bomb.y) * (TILE_SIZE / 4) + offsetY + TILE_SIZE / 4;
  
  ctx.fillStyle = '#1f1f1f';
  ctx.beginPath();
  ctx.arc(iso_x, iso_y, 8, 0, Math.PI * 2);
  ctx.fill();
  
  const progress = Math.max(0, (bomb.explodeAt - Date.now()) / 2500);
  ctx.strokeStyle = `rgba(255, 200, 0, ${progress})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(iso_x, iso_y, 12, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - progress));
  ctx.stroke();
}

function drawExplosion(explosion, offsetX, offsetY) {
  for (const cell of explosion.cells) {
    const iso_x = (cell.x - cell.y) * (TILE_SIZE / 2) + offsetX + TILE_SIZE / 2;
    const iso_y = (cell.x + cell.y) * (TILE_SIZE / 4) + offsetY + TILE_SIZE / 4;
    
    const grad = ctx.createRadialGradient(iso_x, iso_y, 2, iso_x, iso_y, 24);
    grad.addColorStop(0, 'rgba(255, 200, 0, 1)');
    grad.addColorStop(0.5, 'rgba(255, 100, 0, 0.6)');
    grad.addColorStop(1, 'rgba(255, 50, 0, 0)');
    
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(iso_x, iso_y, 24, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawFlag(flagX, flagY, team, offsetX, offsetY) {
  const iso_x = (flagX - flagY) * (TILE_SIZE / 2) + offsetX + TILE_SIZE / 2;
  const iso_y = (flagX + flagY) * (TILE_SIZE / 4) + offsetY + TILE_SIZE / 4 - 16;
  
  const flagColor = team === 'blue' ? '#3b82f6' : '#ef4444';
  ctx.fillStyle = flagColor;
  ctx.fillRect(iso_x, iso_y - 12, 16, 24);
  ctx.fillStyle = '#ffd700';
  ctx.fillRect(iso_x + 1, iso_y - 11, 14, 8);
}

function updateHUD() {
  const myPlayer = getMyPlayer();
  hudElement.innerHTML = `
    <div class="team-score blue">
      🔵 Blue: ${gameState.scores.blue}
    </div>
    <div class="team-score red">
      🔴 Red: ${gameState.scores.red}
    </div>
  `;
}

function render() {
  ctx.fillStyle = '#0a0e27';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const offsetX = centerX - 10 * (TILE_SIZE / 2);
  const offsetY = centerY - 6.5 * (TILE_SIZE / 4);
  
  const map = gameState.map;
  if (map.length > 0) {
    for (let y = 0; y < map.length; y++) {
      for (let x = 0; x < map[0].length; x++) {
        drawIsometricTile(x, y, map[y][x], offsetX, offsetY);
      }
    }
  }
  
  for (const explosion of gameState.explosions) {
    drawExplosion(explosion, offsetX, offsetY);
  }
  
  for (const bomb of gameState.bombs) {
    drawBomb(bomb, offsetX, offsetY);
  }
  
  drawFlag(gameState.flags.blue.x, gameState.flags.blue.y, 'blue', offsetX, offsetY);
  drawFlag(gameState.flags.red.x, gameState.flags.red.y, 'red', offsetX, offsetY);
  
  for (const player of gameState.players) {
    drawPlayer(player, offsetX, offsetY);
  }
  
  updateHUD();
  
  requestAnimationFrame(render);
}

requestAnimationFrame(render);
