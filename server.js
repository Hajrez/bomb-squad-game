const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const MAP_WIDTH = 21;
const MAP_HEIGHT = 13;
const TEAM_BLUE = 'blue';
const TEAM_RED = 'red';

const rooms = new Map();
const BOT_NAMES = { blue: ['BluBot-1', 'BluBot-2'], red: ['RedBot-1', 'RedBot-2'] };

function generateMap() {
  const map = Array(MAP_HEIGHT).fill(null).map(() => Array(MAP_WIDTH).fill(0));
  
  // دیوارهای دور
  for (let y = 0; y < MAP_HEIGHT; y++) {
    map[y][0] = 1;
    map[y][MAP_WIDTH - 1] = 1;
  }
  for (let x = 0; x < MAP_WIDTH; x++) {
    map[0][x] = 1;
    map[MAP_HEIGHT - 1][x] = 1;
  }
  
  // دیوارهای ثابت
  for (let y = 2; y < MAP_HEIGHT - 2; y += 2) {
    for (let x = 2; x < MAP_WIDTH - 2; x += 2) {
      map[y][x] = 1;
    }
  }
  
  // بلوک‌های قابل شکستن
  for (let y = 1; y < MAP_HEIGHT - 1; y++) {
    for (let x = 1; x < MAP_WIDTH - 1; x++) {
      if (map[y][x] === 0 && Math.random() < 0.35) {
        const isSpawn = (x < 4 && y < 4) || (x > MAP_WIDTH - 5 && y < 4) ||
                        (x < 4 && y > MAP_HEIGHT - 5) || (x > MAP_WIDTH - 5 && y > MAP_HEIGHT - 5);
        if (!isSpawn) map[y][x] = 2;
      }
    }
  }
  
  return map;
}

function createRoom(code) {
  return {
    code,
    map: generateMap(),
    players: [],
    bombs: [],
    explosions: [],
    flags: {
      blue: { x: 2, y: 2, carrier: null },
      red: { x: MAP_WIDTH - 3, y: MAP_HEIGHT - 3, carrier: null }
    },
    scores: { blue: 0, red: 0 },
    round: 1,
    started: false,
    roundEndTime: null
  };
}

function getSpawnPoints(team) {
  if (team === TEAM_BLUE) {
    return [{ x: 1, y: 1 }, { x: 2, y: 3 }, { x: 3, y: 2 }];
  } else {
    return [
      { x: MAP_WIDTH - 2, y: MAP_HEIGHT - 2 },
      { x: MAP_WIDTH - 3, y: MAP_HEIGHT - 4 },
      { x: MAP_WIDTH - 4, y: MAP_HEIGHT - 3 }
    ];
  }
}

function isWalkable(map, x, y) {
  if (x < 0 || y < 0 || x >= MAP_WIDTH || y >= MAP_HEIGHT) return false;
  return map[y][x] === 0;
}

function serializeRoom(room) {
  return {
    code: room.code,
    map: room.map,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      team: p.team,
      x: p.x,
      y: p.y,
      alive: p.alive,
      hasFlag: p.hasFlag,
      points: p.points
    })),
    bombs: room.bombs.map(b => ({
      id: b.id,
      x: b.x,
      y: b.y,
      radius: b.radius,
      explodeAt: b.explodeAt
    })),
    explosions: room.explosions.map(e => ({
      cells: e.cells,
      until: e.until
    })),
    flags: {
      blue: { x: room.flags.blue.x, y: room.flags.blue.y },
      red: { x: room.flags.red.x, y: room.flags.red.y }
    },
    scores: room.scores,
    round: room.round
  };
}

function updateBot(room, player) {
  if (!player.bot || !player.alive) return;
  
  const directions = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
  const safeMoves = directions.filter(dir => isWalkable(room.map, player.x + dir.x, player.y + dir.y));
  
  if (safeMoves.length > 0) {
    const move = safeMoves[Math.floor(Math.random() * safeMoves.length)];
    player.x += move.x;
    player.y += move.y;
  }
  
  if (Math.random() < 0.15 && player.bombCooldown < Date.now()) {
    placeBomb(room, player);
  }
}

function placeBomb(room, player) {
  if (Date.now() < player.bombCooldown) return;
  
  room.bombs.push({
    id: `${player.id}-${Date.now()}`,
    x: player.x,
    y: player.y,
    ownerId: player.id,
    radius: 3,
    explodeAt: Date.now() + 2500
  });
  
  player.bombCooldown = Date.now() + 800;
}

function explodeBomb(room, bomb) {
  const cells = [{ x: bomb.x, y: bomb.y }];
  const directions = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
  
  for (const dir of directions) {
    for (let i = 1; i <= bomb.radius; i++) {
      const nx = bomb.x + dir.x * i;
      const ny = bomb.y + dir.y * i;
      if (!isWalkable(room.map, nx, ny)) {
        if (room.map[ny][nx] === 2) {
          room.map[ny][nx] = 0;
          cells.push({ x: nx, y: ny });
        }
        break;
      }
      cells.push({ x: nx, y: ny });
    }
  }
  
  room.explosions.push({ cells, until: Date.now() + 300 });
  
  for (const player of room.players) {
    if (!player.alive) continue;
    if (cells.some(c => c.x === player.x && c.y === player.y)) {
      player.alive = false;
      if (player.hasFlag) {
        player.hasFlag = false;
        const flagKey = player.team === TEAM_BLUE ? 'red' : 'blue';
        room.flags[flagKey].carrier = null;
      }
    }
  }
}

function handleRoomTick(room) {
  if (!room.started) return;
  
  for (const player of room.players) {
    if (player.bot) updateBot(room, player);
  }
  
  for (const bomb of [...room.bombs]) {
    if (Date.now() >= bomb.explodeAt) {
      explodeBomb(room, bomb);
      room.bombs = room.bombs.filter(b => b.id !== bomb.id);
    }
  }
  
  room.explosions = room.explosions.filter(e => Date.now() < e.until);
  
  const alivePlayers = room.players.filter(p => p.alive);
  if (alivePlayers.length === 0 && !room.roundEndTime) {
    room.roundEndTime = Date.now() + 3000;
  }
  
  if (room.roundEndTime && Date.now() >= room.roundEndTime) {
    startNewRound(room);
  }
}

function startNewRound(room) {
  room.map = generateMap();
  room.bombs = [];
  room.explosions = [];
  room.round += 1;
  room.roundEndTime = null;
  
  const blueSpawns = getSpawnPoints(TEAM_BLUE);
  const redSpawns = getSpawnPoints(TEAM_RED);
  
  let blueIdx = 0, redIdx = 0;
  for (const player of room.players) {
    player.alive = true;
    player.bombCooldown = 0;
    player.hasFlag = false;
    
    if (player.team === TEAM_BLUE) {
      const spawn = blueSpawns[blueIdx % blueSpawns.length];
      player.x = spawn.x;
      player.y = spawn.y;
      blueIdx++;
    } else {
      const spawn = redSpawns[redIdx % redSpawns.length];
      player.x = spawn.x;
      player.y = spawn.y;
      redIdx++;
    }
  }
  
  room.flags.blue.carrier = null;
  room.flags.red.carrier = null;
}

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_, res) => res.json({ ok: true }));

io.on('connection', (socket) => {
  socket.on('joinRoom', ({ code, name, team }) => {
    const roomCode = (code || 'BOMB').toUpperCase();
    let room = rooms.get(roomCode);
    if (!room) {
      room = createRoom(roomCode);
      rooms.set(roomCode, room);
    }
    
    const playerTeam = team === TEAM_RED ? TEAM_RED : TEAM_BLUE;
    const spawns = getSpawnPoints(playerTeam);
    const spawn = spawns[Math.floor(Math.random() * spawns.length)];
    
    const player = {
      id: socket.id,
      name: name || 'Player',
      team: playerTeam,
      x: spawn.x,
      y: spawn.y,
      alive: true,
      hasFlag: false,
      points: 0,
      bot: false,
      bombCooldown: 0
    };
    
    room.players.push(player);
    socket.join(roomCode);
    room.started = true;
    
    // ا��افه کردن بات‌ها
    while (room.players.filter(p => p.team === TEAM_BLUE && p.bot).length < 1) {
      const botSpawns = getSpawnPoints(TEAM_BLUE);
      room.players.push({
        id: `bot-${Date.now()}-${Math.random()}`,
        name: BOT_NAMES.blue[room.players.filter(p => p.team === TEAM_BLUE && p.bot).length],
        team: TEAM_BLUE,
        x: botSpawns[0].x,
        y: botSpawns[0].y,
        alive: true,
        hasFlag: false,
        points: 0,
        bot: true,
        bombCooldown: 0
      });
    }
    
    while (room.players.filter(p => p.team === TEAM_RED && p.bot).length < 1) {
      const botSpawns = getSpawnPoints(TEAM_RED);
      room.players.push({
        id: `bot-${Date.now()}-${Math.random()}`,
        name: BOT_NAMES.red[room.players.filter(p => p.team === TEAM_RED && p.bot).length],
        team: TEAM_RED,
        x: botSpawns[0].x,
        y: botSpawns[0].y,
        alive: true,
        hasFlag: false,
        points: 0,
        bot: true,
        bombCooldown: 0
      });
    }
    
    socket.emit('joined', { roomCode, team: playerTeam });
    io.to(roomCode).emit('state', serializeRoom(room));
  });
  
  socket.on('move', ({ roomCode, dx, dy }) => {
    const room = rooms.get(roomCode?.toUpperCase());
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player || !player.alive) return;
    
    const nx = player.x + dx;
    const ny = player.y + dy;
    if (isWalkable(room.map, nx, ny)) {
      player.x = nx;
      player.y = ny;
      
      // پرچم را برداشت
      const flagKey = player.team === TEAM_BLUE ? 'red' : 'blue';
      if (room.flags[flagKey].x === nx && room.flags[flagKey].y === ny && !room.flags[flagKey].carrier) {
        player.hasFlag = true;
        room.flags[flagKey].carrier = player.id;
      }
    }
  });
  
  socket.on('bomb', ({ roomCode }) => {
    const room = rooms.get(roomCode?.toUpperCase());
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (player) placeBomb(room, player);
  });
  
  socket.on('flagCapture', ({ roomCode }) => {
    const room = rooms.get(roomCode?.toUpperCase());
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player || !player.hasFlag) return;
    
    const homeFlag = player.team === TEAM_BLUE ? 'blue' : 'red';
    if (player.x >= 1 && player.x <= 3 && player.y >= 1 && player.y <= 3 && player.team === TEAM_BLUE) {
      room.scores[TEAM_BLUE]++;
      player.points += 10;
      player.hasFlag = false;
      room.flags.red.carrier = null;
      io.to(roomCode).emit('captured', { team: TEAM_BLUE });
    } else if (player.x >= MAP_WIDTH - 4 && player.x <= MAP_WIDTH - 2 && player.y >= MAP_HEIGHT - 4 && player.y <= MAP_HEIGHT - 2 && player.team === TEAM_RED) {
      room.scores[TEAM_RED]++;
      player.points += 10;
      player.hasFlag = false;
      room.flags.blue.carrier = null;
      io.to(roomCode).emit('captured', { team: TEAM_RED });
    }
  });
  
  socket.on('disconnect', () => {
    for (const room of rooms.values()) {
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx >= 0) {
        room.players.splice(idx, 1);
        if (room.players.length === 0) {
          rooms.delete(room.code);
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
}, 100);

server.listen(PORT, () => {
  console.log(`🎮 Bomb Squad 3D server on http://localhost:${PORT}`);
});
