const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;
const ROOM_CAPACITY = 4;
const BOT_NAMES = ['Bot-1', 'Bot-2', 'Bot-3', 'Bot-4'];
const COLORS = ['#ff7f50', '#4ecdc4', '#45aaf2', '#f7b267', '#9b59b6', '#f1c40f'];

const rooms = new Map();

function generateMap(width = 13, height = 11) {
  const map = Array.from({ length: height }, () => Array(width).fill(0));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const isBorder = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      if (isBorder) map[y][x] = 1;
    }
  }

  for (let y = 2; y < height - 2; y += 2) {
    for (let x = 2; x < width - 2; x += 2) {
      map[y][x] = 1;
    }
  }

  const spawnCoords = [
    { x: 1, y: 1 },
    { x: width - 2, y: 1 },
    { x: 1, y: height - 2 },
    { x: width - 2, y: height - 2 }
  ];

  for (const spawn of spawnCoords) {
    map[spawn.y][spawn.x] = 0;
  }

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (map[y][x] !== 0) continue;
      if (Math.random() < 0.42) {
        const isSpawn = spawnCoords.some((s) => s.x === x && s.y === y);
        if (!isSpawn) map[y][x] = 2;
      }
    }
  }

  return map;
}

function getSpawnPoints(width, height) {
  return [
    { x: 1, y: 1 },
    { x: width - 2, y: 1 },
    { x: 1, y: height - 2 },
    { x: width - 2, y: height - 2 }
  ];
}

function serializeRoom(room) {
  return {
    code: room.code,
    maxPlayers: room.maxPlayers,
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      x: player.x,
      y: player.y,
      alive: player.alive,
      color: player.color,
      points: player.points,
      bot: player.bot,
      direction: player.direction,
      radius: player.radius,
      bombCooldown: player.bombCooldown
    })),
    bombs: room.bombs.map((bomb) => ({
      id: bomb.id,
      x: bomb.x,
      y: bomb.y,
      ownerId: bomb.ownerId,
      explodeAt: bomb.explodeAt,
      radius: bomb.radius
    })),
    explosions: room.explosions.map((explosion) => ({
      cells: explosion.cells,
      until: explosion.until
    })),
    map: room.map,
    started: room.started,
    round: room.round,
    winner: room.winner,
    roundOverUntil: room.roundOverUntil,
    currentPlayerCount: room.players.length
  };
}

function isWalkable(map, x, y) {
  if (x < 0 || y < 0 || y >= map.length || x >= map[0].length) return false;
  return map[y][x] === 0;
}

function getCellKey(x, y) {
  return `${x},${y}`;
}

function setPlayerDirection(player, dir) {
  if (dir.x > 0) player.direction = 'right';
  if (dir.x < 0) player.direction = 'left';
  if (dir.y > 0) player.direction = 'down';
  if (dir.y < 0) player.direction = 'up';
}

function canPlaceBomb(room, player) {
  return player.alive && Date.now() >= player.bombCooldown;
}

function placeBomb(room, player) {
  if (!canPlaceBomb(room, player)) return;

  const bomb = {
    id: `${player.id}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    x: player.x,
    y: player.y,
    ownerId: player.id,
    radius: player.radius,
    explodeAt: Date.now() + 2000
  };

  room.bombs.push(bomb);
  player.bombCooldown = Date.now() + 700;
}

function explodeBomb(room, bomb) {
  const cells = [{ x: bomb.x, y: bomb.y }];
  const directions = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 }
  ];

  for (const dir of directions) {
    for (let i = 1; i <= bomb.radius; i++) {
      const nx = bomb.x + dir.x * i;
      const ny = bomb.y + dir.y * i;
      if (ny < 0 || nx < 0 || ny >= room.map.length || nx >= room.map[0].length) break;
      const tile = room.map[ny][nx];
      if (tile === 1) break;

      cells.push({ x: nx, y: ny });

      if (tile === 2) {
        room.map[ny][nx] = 0;
        break;
      }
    }
  }

  room.explosions.push({ cells, until: Date.now() + 240 });

  for (const player of room.players) {
    if (!player.alive) continue;
    const isHit = cells.some((cell) => cell.x === player.x && cell.y === player.y);
    if (isHit) {
      player.alive = false;
    }
  }
}

function startNewRound(room) {
  room.map = generateMap();
  room.bombs = [];
  room.explosions = [];
  room.round += 1;
  room.winner = null;
  room.roundOverUntil = 0;

  const spawnPoints = getSpawnPoints(room.map[0].length, room.map.length);

  room.players.forEach((player, index) => {
    const spawn = spawnPoints[index % spawnPoints.length] || { x: 1, y: 1 };
    player.x = spawn.x;
    player.y = spawn.y;
    player.alive = true;
    player.bombCooldown = 0;
    player.direction = 'down';
  });
}

function updateBot(room, player) {
  if (!player.bot || !player.alive) return;

  const directions = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 }
  ];

  const danger = new Set();
  for (const bomb of room.bombs) {
    const blast = [{ x: bomb.x, y: bomb.y }];
    const dirs = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 }
    ];

    for (const dir of dirs) {
      for (let i = 1; i <= bomb.radius; i++) {
        const nx = bomb.x + dir.x * i;
        const ny = bomb.y + dir.y * i;
        if (ny < 0 || nx < 0 || ny >= room.map.length || nx >= room.map[0].length) break;
        blast.push({ x: nx, y: ny });
        if (room.map[ny][nx] === 1) break;
      }
    }

    blast.forEach((cell) => danger.add(getCellKey(cell.x, cell.y)));
  }

  let bestOption = null;
  let bestScore = -Infinity;

  for (const dir of directions) {
    const nx = player.x + dir.x;
    const ny = player.y + dir.y;
    if (!isWalkable(room.map, nx, ny)) continue;

    if (danger.has(getCellKey(nx, ny))) {
      continue;
    }

    const targetPlayers = room.players.filter((p) => p.id !== player.id && p.alive);
    let score = 0;
    const nearEnemy = targetPlayers
      .map((p) => ({ p, dist: Math.abs(p.x - nx) + Math.abs(p.y - ny) }))
      .sort((a, b) => a.dist - b.dist)[0];

    if (nearEnemy) {
      score += 80 - nearEnemy.dist * 4;
    }

    const breakable = [];
    for (let y = -2; y <= 2; y++) {
      for (let x = -2; x <= 2; x++) {
        const bx = nx + x;
        const by = ny + y;
        if (by < 0 || bx < 0 || by >= room.map.length || bx >= room.map[0].length) continue;
        if (room.map[by][bx] === 2) breakable.push({ x: bx, y: by });
      }
    }

    if (breakable.length > 0) {
      score += 35;
    }

    if (Math.random() < 0.12 && canPlaceBomb(room, player)) {
      score += 10;
    }

    if (score > bestScore) {
      bestScore = score;
      bestOption = dir;
    }
  }

  if (bestOption) {
    player.x += bestOption.x;
    player.y += bestOption.y;
    setPlayerDirection(player, bestOption);
  }

  if (Math.random() < 0.28 && canPlaceBomb(room, player)) {
    const enemyNearby = room.players.some((p) => p.id !== player.id && p.alive && Math.abs(p.x - player.x) + Math.abs(p.y - player.y) <= 4);
    if (enemyNearby) {
      placeBomb(room, player);
    }
  }
}

function handleRoomTick(room) {
  if (!room.started) return;

  for (const player of room.players) {
    if (player.bot) {
      updateBot(room, player);
    }
  }

  for (const bomb of [...room.bombs]) {
    if (Date.now() >= bomb.explodeAt) {
      explodeBomb(room, bomb);
      room.bombs = room.bombs.filter((entry) => entry.id !== bomb.id);
    }
  }

  for (const explosion of [...room.explosions]) {
    if (Date.now() >= explosion.until) {
      room.explosions = room.explosions.filter((entry) => entry.until !== explosion.until);
    }
  }

  const alive = room.players.filter((player) => player.alive);
  if (alive.length <= 1 && !room.roundOverUntil) {
    const winner = alive[0];
    if (winner) {
      winner.points += 1;
      room.winner = winner.name;
    } else {
      room.winner = 'Draw';
    }
    room.roundOverUntil = Date.now() + 2600;
  }

  if (room.roundOverUntil && Date.now() >= room.roundOverUntil) {
    startNewRound(room);
  }
}

function ensureBotsForRoom(room) {
  if (room.players.length >= room.maxPlayers) return;

  while (room.players.length < room.maxPlayers) {
    const botIndex = room.players.length;
    const spawn = getSpawnPoints(room.map[0].length, room.map.length)[botIndex % 4];

    room.players.push({
      id: `bot-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      name: BOT_NAMES[botIndex] || `Bot-${botIndex + 1}`,
      x: spawn.x,
      y: spawn.y,
      color: COLORS[botIndex % COLORS.length],
      radius: 2,
      alive: true,
      points: 0,
      bot: true,
      direction: 'down',
      bombCooldown: 0
    });
  }
}

function createRoom(code, maxPlayers) {
  const room = {
    code,
    maxPlayers: Math.min(Math.max(parseInt(maxPlayers, 10) || 2, 2), ROOM_CAPACITY),
    players: [],
    bombs: [],
    explosions: [],
    map: generateMap(),
    started: false,
    winner: null,
    round: 1,
    roundOverUntil: 0
  };

  rooms.set(code, room);
  return room;
}

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (_, res) => {
  res.json({ ok: true, rooms: rooms.size });
});

io.on('connection', (socket) => {
  socket.on('joinRoom', ({ roomCode, name, playerCount }) => {
    const code = String(roomCode || 'BOMB').trim().toUpperCase();
    const playerName = String(name || 'Player').trim().slice(0, 14) || 'Player';
    const room = rooms.get(code) || createRoom(code, playerCount || 2);

    if (room.players.length >= room.maxPlayers) {
      socket.emit('roomFull', { code: room.code });
      return;
    }

    const spawnPoints = getSpawnPoints(room.map[0].length, room.map.length);
    const spawn = spawnPoints[room.players.length % spawnPoints.length];

    const player = {
      id: socket.id,
      name: playerName,
      x: spawn.x,
      y: spawn.y,
      color: COLORS[room.players.length % COLORS.length],
      radius: 2,
      alive: true,
      points: 0,
      bot: false,
      direction: 'down',
      bombCooldown: 0
    };

    room.players.push(player);
    socket.join(code);
    room.started = true;
    ensureBotsForRoom(room);

    socket.emit('joined', {
      roomCode: room.code,
      playerCount: room.maxPlayers
    });

    io.to(code).emit('state', serializeRoom(room));
  });

  socket.on('move', ({ roomCode, dir }) => {
    const room = rooms.get(String(roomCode || '').trim().toUpperCase());
    if (!room) return;

    const player = room.players.find((entry) => entry.id === socket.id);
    if (!player || !player.alive) return;

    if (!dir || typeof dir.x !== 'number' || typeof dir.y !== 'number') return;

    const nextX = player.x + dir.x;
    const nextY = player.y + dir.y;
    if (isWalkable(room.map, nextX, nextY)) {
      player.x = nextX;
      player.y = nextY;
      setPlayerDirection(player, dir);
    }
  });

  socket.on('placeBomb', ({ roomCode }) => {
    const room = rooms.get(String(roomCode || '').trim().toUpperCase());
    if (!room) return;

    const player = room.players.find((entry) => entry.id === socket.id);
    if (player) {
      placeBomb(room, player);
      io.to(room.code).emit('state', serializeRoom(room));
    }
  });

  socket.on('disconnect', () => {
    for (const room of rooms.values()) {
      const index = room.players.findIndex((player) => player.id === socket.id);
      if (index >= 0) {
        room.players.splice(index, 1);
        if (room.players.length === 0) {
          rooms.delete(room.code);
        } else {
          room.started = true;
          ensureBotsForRoom(room);
          io.to(room.code).emit('state', serializeRoom(room));
        }
      }
    }
  });
});

setInterval(() => {
  for (const room of rooms.values()) {
    handleRoomTick(room);
    io.to(room.code).emit('state', serializeRoom(room));
  }
}, 110);

server.listen(PORT, () => {
  console.log(`Bomb squad server listening on http://localhost:${PORT}`);
});
