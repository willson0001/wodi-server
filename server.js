const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const app = express();
app.use(express.json());
app.use(require('cors')());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const WORDS_FILE = path.join(__dirname, 'words.json');
let words = JSON.parse(fs.readFileSync(WORDS_FILE, 'utf8'));

const PORT = process.env.PORT || 3000;

const rooms = new Map();
const playerRooms = new Map();
const playerHeartbeat = new Map();

const ROOM_ID_CHARS = '0123456789';

function generateRoomId() {
  let id;
  do {
    id = '';
    for (let i = 0; i < 4; i++) {
      id += ROOM_ID_CHARS[Math.floor(Math.random() * ROOM_ID_CHARS.length)];
    }
  } while (rooms.has(id));
  return id;
}

function generatePlayerId() {
  return 'p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function getRandomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getPlayersSnapshot(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  const players = [];
  room.players.forEach((p, id) => {
    players.push({ id, ...p });
  });
  return players;
}

function getAlivePlayers(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  const alive = [];
  room.players.forEach((p, id) => {
    if (p.alive) alive.push(p);
  });
  return alive;
}

function assignRolesAndWords(roomId) {
  const room = rooms.get(roomId);
  const alivePlayers = getAlivePlayers(roomId);
  const spyPlayer = getRandomItem(alivePlayers);
  const wordPair = getRandomItem(room.wordsPool);
  room.wordPair = wordPair;
  const civilians = alivePlayers.filter(p => p.id !== spyPlayer.id);
  spyPlayer.role = 'spy';
  spyPlayer.word = wordPair.wordB;
  civilians.forEach(p => {
    p.role = 'civilian';
    p.word = wordPair.wordA;
  });
}

function broadcastRoomState(roomId, excludeId = null) {
  const room = rooms.get(roomId);
  if (!room) return;
  room.players.forEach((p, id) => {
    if (id === excludeId) return;
    const socketId = playerRooms.get(id);
    if (socketId) {
      io.to(socketId).emit('ROOM_STATE', {
        roomId,
        phase: room.phase,
        round: room.round,
        status: room.status,
        players: getPlayersSnapshot(roomId).map(pl => ({
          id: pl.id,
          name: pl.name,
          number: pl.number,
          isHost: pl.isHost,
          alive: pl.alive,
          votedFor: pl.votedFor || null
        })),
        lastEliminated: room.lastEliminated,
        myWord: p.word,
        myRole: p.role
      });
    }
  });
}

function checkAllVoted(roomId) {
  const room = rooms.get(roomId);
  const alivePlayers = getAlivePlayers(roomId);
  return alivePlayers.every(p => p.votedFor !== null);
}

function countVotes(roomId) {
  const room = rooms.get(roomId);
  const votes = {};
  room.players.forEach((p) => {
    if (p.alive && p.votedFor) {
      votes[p.votedFor] = (votes[p.votedFor] || 0) + 1;
    }
  });
  return votes;
}

function checkWinCondition(roomId) {
  const alivePlayers = getAlivePlayers(roomId);
  const aliveSpies = alivePlayers.filter(p => p.role === 'spy');
  const aliveCivilians = alivePlayers.filter(p => p.role === 'civilian');

  if (aliveSpies.length === 0) {
    return { result: 'civilian_win' };
  }
  if (aliveSpies.length >= aliveCivilians.length) {
    return { result: 'spy_win' };
  }
  if (aliveCivilians.length < 2) {
    return { result: 'spy_win' };
  }
  return null;
}

function resetVotes(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  room.players.forEach((p) => {
    p.votedFor = null;
  });
  room.votes = {};
}

function cleanupRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  room.players.forEach((p, id) => {
    const socketId = playerRooms.get(id);
    if (socketId) {
      io.to(socketId).emit('ROOM_CLOSED');
    }
    playerRooms.delete(id);
    playerHeartbeat.delete(id);
  });
  rooms.delete(roomId);
}

setInterval(() => {
  const now = Date.now();
  rooms.forEach((room, roomId) => {
    if (room.status !== 'waiting') return;
    if (room.players.size === 0) {
      rooms.delete(roomId);
      return;
    }
    let allLeft = true;
    room.players.forEach((p, id) => {
      const lastBeat = playerHeartbeat.get(id) || 0;
      if (now - lastBeat < 300000) {
        allLeft = false;
      }
    });
    if (allLeft) {
      cleanupRoom(roomId);
    }
  });
}, 60000);

app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: '谁是卧底 WebSocket 服务器',
    version: '1.0.0',
    rooms: rooms.size,
    uptime: process.uptime()
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', rooms: rooms.size });
});

app.get('/words.json', (req, res) => {
  res.json(words);
});

async function fetchRemoteWords(url) {
  try {
    const resp = await axios.get(url, { timeout: 10000 });
    if (resp.data && resp.data.easy && resp.data.normal && resp.data.hard) {
      const newWords = resp.data;
      let addedCount = 0;
      
      const existingEasySet = new Set(words.easy.map(w => `${w.wordA}-${w.wordB}`));
      newWords.easy.forEach(newWord => {
        const key = `${newWord.wordA}-${newWord.wordB}`;
        if (!existingEasySet.has(key)) {
          words.easy.push(newWord);
          existingEasySet.add(key);
          addedCount++;
        }
      });
      
      const existingNormalSet = new Set(words.normal.map(w => `${w.wordA}-${w.wordB}`));
      newWords.normal.forEach(newWord => {
        const key = `${newWord.wordA}-${newWord.wordB}`;
        if (!existingNormalSet.has(key)) {
          words.normal.push(newWord);
          existingNormalSet.add(key);
          addedCount++;
        }
      });
      
      const existingHardSet = new Set(words.hard.map(w => `${w.wordA}-${w.wordB}`));
      newWords.hard.forEach(newWord => {
        const key = `${newWord.wordA}-${newWord.wordB}`;
        if (!existingHardSet.has(key)) {
          words.hard.push(newWord);
          existingHardSet.add(key);
          addedCount++;
        }
      });
      
      words.version = new Date().toISOString().split('T')[0];
      fs.writeFileSync(WORDS_FILE, JSON.stringify(words, null, 2));
      return { success: true, addedCount, count: words.easy.length + words.normal.length + words.hard.length };
    }
    return { success: false, error: 'Invalid format' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  let currentPlayerId = null;
  let currentRoomId = null;

  socket.on('FETCH_WORDS', async (data) => {
    if (data && data.url) {
      const result = await fetchRemoteWords(data.url);
      socket.emit('FETCH_WORDS_RESULT', result);
    } else {
      const total = (words.easy?.length || 0) + (words.normal?.length || 0) + (words.hard?.length || 0);
      socket.emit('FETCH_WORDS_RESULT', { success: true, count: total, version: words.version });
    }
  });

  socket.on('CREATE_ROOM', (data) => {
    const playerId = generatePlayerId();
    const roomId = generateRoomId();
    const player = {
      id: playerId,
      name: data.name || '玩家',
      isHost: true,
      number: 1,
      role: null,
      word: null,
      alive: true,
      votedFor: null,
      online: true,
      joinedAt: Date.now()
    };
    const room = {
      id: roomId,
      hostId: playerId,
      status: 'waiting',
      difficulty: data.difficulty || 'normal',
      phase: 'waiting',
      round: 0,
      wordPair: null,
      wordsPool: [...(words[data.difficulty] || words.normal || [])],
      players: new Map([[playerId, player]]),
      lastEliminated: null,
      createdAt: Date.now()
    };
    rooms.set(roomId, room);
    playerRooms.set(playerId, socket.id);
    playerHeartbeat.set(playerId, Date.now());
    currentPlayerId = playerId;
    currentRoomId = roomId;
    socket.join(roomId);
    socket.emit('ROOM_CREATED', {
      roomId,
      playerId,
      player: { id: playerId, name: player.name, number: 1, isHost: true, alive: true }
    });
    console.log(`Room ${roomId} created by ${playerId}`);
  });

  socket.on('JOIN_ROOM', (data) => {
    const roomId = (data.roomId || '').toUpperCase().trim();
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit('ERROR', { message: '房间不存在' });
      return;
    }
    if (room.status !== 'waiting') {
      socket.emit('ERROR', { message: '游戏已开始，无法加入' });
      return;
    }
    if (room.players.size >= 12) {
      socket.emit('ERROR', { message: '房间已满' });
      return;
    }
    if (currentPlayerId && currentRoomId) {
      const oldRoom = rooms.get(currentRoomId);
      if (oldRoom) {
        oldRoom.players.delete(currentPlayerId);
        socket.leave(currentRoomId);
      }
      playerRooms.delete(currentPlayerId);
    }
    const playerId = generatePlayerId();
    const playerCount = room.players.size;
    const player = {
      id: playerId,
      name: data.name || '玩家',
      isHost: false,
      number: playerCount + 1,
      role: null,
      word: null,
      alive: true,
      votedFor: null,
      online: true,
      joinedAt: Date.now()
    };
    room.players.set(playerId, player);
    playerRooms.set(playerId, socket.id);
    playerHeartbeat.set(playerId, Date.now());
    currentPlayerId = playerId;
    currentRoomId = roomId;
    socket.join(roomId);
    const playerData = { id: playerId, name: player.name, number: player.number, isHost: false, alive: true };
    socket.emit('ROOM_JOINED', { roomId, playerId, player: playerData });
    socket.to(roomId).emit('PLAYER_JOINED', {
      player: playerData,
      players: getPlayersSnapshot(roomId)
    });
    socket.emit('ROOM_STATE', {
      roomId,
      phase: room.phase,
      round: room.round,
      status: room.status,
      players: getPlayersSnapshot(roomId).map(p => ({
        id: p.id,
        name: p.name,
        number: p.number,
        isHost: p.isHost,
        alive: p.alive,
        votedFor: null
      })),
      lastEliminated: room.lastEliminated,
      myWord: null,
      myRole: null
    });
    console.log(`Player ${playerId} joined room ${roomId}`);
  });

  socket.on('START_GAME', () => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    if (room.hostId !== currentPlayerId) {
      socket.emit('ERROR', { message: '只有法官可以开始游戏' });
      return;
    }
    if (room.players.size < 4) {
      socket.emit('ERROR', { message: '至少需要4人才能开始' });
      return;
    }
    room.phase = 'describe';
    room.round = 1;
    room.status = 'playing';
    room.lastEliminated = null;
    resetVotes(currentRoomId);
    room.players.forEach(p => {
      p.alive = true;
      p.votedFor = null;
      p.role = null;
      p.word = null;
    });
    room.wordsPool = [...(words[room.difficulty] || words.normal || [])];
    assignRolesAndWords(currentRoomId);
    room.players.forEach((p, id) => {
      const sid = playerRooms.get(id);
      if (sid) {
        io.to(sid).emit('GAME_STARTED', {
          round: room.round,
          phase: room.phase,
          myWord: p.word,
          myRole: null,
          players: getPlayersSnapshot(currentRoomId).map(pl => ({
            id: pl.id, name: pl.name, number: pl.number, isHost: pl.isHost, alive: pl.alive
          }))
        });
      }
    });
    console.log(`Game started in room ${currentRoomId}`);
  });

  socket.on('KICK_PLAYER', (data) => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    if (room.hostId !== currentPlayerId) {
      socket.emit('ERROR', { message: '只有法官可以踢人' });
      return;
    }
    if (room.status !== 'waiting') {
      socket.emit('ERROR', { message: '游戏已开始，无法踢人' });
      return;
    }
    const targetId = data.targetId;
    if (!targetId || targetId === currentPlayerId) return;
    if (!room.players.has(targetId)) return;
    const targetSocketId = playerRooms.get(targetId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('KICKED');
    }
    room.players.delete(targetId);
    playerRooms.delete(targetId);
    playerHeartbeat.delete(targetId);
    let num = 1;
    room.players.forEach(p => { p.number = num++; });
    io.to(currentRoomId).emit('PLAYER_LEFT', {
      playerId: targetId,
      players: getPlayersSnapshot(currentRoomId).map(p => ({
        id: p.id, name: p.name, number: p.number, isHost: p.isHost, alive: p.alive
      }))
    });
    if (room.players.size === 0) {
      rooms.delete(currentRoomId);
    }
    console.log(`Player ${targetId} kicked from room ${currentRoomId}`);
  });

  socket.on('REASSIGN_WORDS', () => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    if (room.hostId !== currentPlayerId) {
      socket.emit('ERROR', { message: '只有法官可以换词' });
      return;
    }
    if (room.status !== 'playing') return;
    assignRolesAndWords(currentRoomId);
    room.players.forEach((p, id) => {
      const sid = playerRooms.get(id);
      if (sid) {
        io.to(sid).emit('GAME_STARTED', {
          round: room.round,
          phase: room.phase,
          myWord: p.word,
          myRole: null,
          players: getPlayersSnapshot(currentRoomId).map(pl => ({
            id: pl.id, name: pl.name, number: pl.number, isHost: pl.isHost, alive: pl.alive
          }))
        });
      }
    });
    console.log(`Words reassigned in room ${currentRoomId}`);
  });

  socket.on('SET_PHASE', (data) => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    if (room.hostId !== currentPlayerId) return;
    const newPhase = data.phase;
    if (newPhase !== 'describe' && newPhase !== 'vote') return;
    room.phase = newPhase;
    if (newPhase === 'vote') {
      resetVotes(currentRoomId);
    }
    io.to(currentRoomId).emit('PHASE_CHANGED', { phase: newPhase, round: room.round });
    broadcastRoomState(currentRoomId);
  });

  socket.on('VOTE', (data) => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    if (room.phase !== 'vote') return;
    const voter = room.players.get(currentPlayerId);
    if (!voter || !voter.alive) return;
    const targetId = data.targetId;
    if (!room.players.has(targetId)) return;
    const target = room.players.get(targetId);
    if (!target.alive) return;
    if (targetId === currentPlayerId) return;
    voter.votedFor = targetId;
    io.to(currentRoomId).emit('VOTE_RECEIVED', {
      playerId: currentPlayerId,
      playerNumber: voter.number,
      playerName: voter.name,
      totalAlive: getAlivePlayers(currentRoomId).length
    });
    if (checkAllVoted(currentRoomId)) {
      const votes = countVotes(currentRoomId);
      const sorted = Object.entries(votes).sort((a, b) => b[1] - a[1]);
      const topCount = sorted[0][1];
      const topPlayers = sorted.filter(x => x[1] === topCount).map(x => x[0]);
      let eliminated = null;
      if (topPlayers.length === 1) {
        const targetPlayer = room.players.get(topPlayers[0]);
        if (targetPlayer) {
          targetPlayer.alive = false;
          eliminated = { id: topPlayers[0], name: targetPlayer.name, number: targetPlayer.number, role: targetPlayer.role };
          room.lastEliminated = { name: targetPlayer.name, number: targetPlayer.number };
        }
      }
      resetVotes(currentRoomId);
      io.to(currentRoomId).emit('VOTE_RESULT', {
        votes,
        eliminated,
        isTie: topPlayers.length > 1,
        players: getPlayersSnapshot(currentRoomId).map(p => ({
          id: p.id, name: p.name, number: p.number, isHost: p.isHost, alive: p.alive
        }))
      });
      if (eliminated) {
        const winResult = checkWinCondition(currentRoomId);
        if (winResult) {
          room.status = 'finished';
          room.phase = 'finished';
          io.to(currentRoomId).emit('GAME_OVER', {
            result: winResult.result,
            players: getPlayersSnapshot(currentRoomId).map(p => ({
              id: p.id, name: p.name, number: p.number, role: p.role, word: p.word, alive: p.alive
            }))
          });
        }
      }
    }
  });

  socket.on('NEXT_ROUND', () => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    if (room.hostId !== currentPlayerId) return;
    if (room.status === 'finished') return;
    room.round++;
    room.phase = 'describe';
    resetVotes(currentRoomId);
    io.to(currentRoomId).emit('NEXT_ROUND_START', { round: room.round, phase: 'describe' });
    broadcastRoomState(currentRoomId);
  });

  socket.on('RESTART_GAME', () => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    if (room.hostId !== currentPlayerId) return;
    room.status = 'waiting';
    room.phase = 'waiting';
    room.round = 0;
    room.lastEliminated = null;
    room.wordPair = null;
    resetVotes(currentRoomId);
    room.players.forEach(p => {
      p.alive = true;
      p.role = null;
      p.word = null;
      p.votedFor = null;
    });
    io.to(currentRoomId).emit('GAME_RESTARTED', {
      players: getPlayersSnapshot(currentRoomId)
    });
  });

  socket.on('RESTART_VOTE', () => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    if (room.hostId !== currentPlayerId) return;
    resetVotes(currentRoomId);
    room.phase = 'vote';
    io.to(currentRoomId).emit('PHASE_CHANGED', { phase: 'vote', round: room.round, isRestart: true });
    broadcastRoomState(currentRoomId);
  });

  socket.on('TAKE_OVER_HOST', () => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    if (room.status !== 'playing') return;
    const oldHost = room.players.get(room.hostId);
    const lastBeat = playerHeartbeat.get(room.hostId) || 0;
    if (Date.now() - lastBeat < 120000) return;
    room.hostId = currentPlayerId;
    const newHost = room.players.get(currentPlayerId);
    if (newHost) newHost.isHost = true;
    if (oldHost && oldHost.id !== currentPlayerId) oldHost.isHost = false;
    io.to(currentRoomId).emit('HOST_CHANGED', {
      oldHostId: oldHost ? oldHost.id : null,
      newHostId: currentPlayerId,
      newHostName: newHost ? newHost.name : null
    });
    broadcastRoomState(currentRoomId);
  });

  socket.on('HEARTBEAT', (data) => {
    if (!currentPlayerId) return;
    playerHeartbeat.set(currentPlayerId, Date.now());
    const room = rooms.get(currentRoomId);
    if (room && room.hostId) {
      const lastBeat = playerHeartbeat.get(room.hostId) || 0;
      if (Date.now() - lastBeat > 120000 && room.status === 'playing') {
        socket.emit('HOST_OFFLINE_WARNING');
      }
    }
  });

  socket.on('LEAVE_ROOM', (data) => {
    const roomId = data.roomId;
    if (!currentPlayerId || !roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    
    room.players.delete(currentPlayerId);
    playerRooms.delete(currentPlayerId);
    playerHeartbeat.delete(currentPlayerId);
    
    io.to(roomId).emit('PLAYER_LEFT', {
      playerId: currentPlayerId,
      players: getPlayersSnapshot(roomId).map(p => ({
        id: p.id, name: p.name, number: p.number, isHost: p.isHost, alive: p.alive
      }))
    });
    
    if (room.players.size === 0) {
      rooms.delete(roomId);
    }
    console.log(`Player ${currentPlayerId} left room ${roomId}`);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    if (!currentPlayerId) return;
    playerHeartbeat.delete(currentPlayerId);
    const room = rooms.get(currentRoomId);
    if (room) {
      const player = room.players.get(currentPlayerId);
      if (player) {
        player.online = false;
      }
      io.to(currentRoomId).emit('PLAYER_OFFLINE', { playerId: currentPlayerId, playerName: player?.name });
      if (room.status === 'waiting') {
        room.players.delete(currentPlayerId);
        io.to(currentRoomId).emit('PLAYER_LEFT', {
          playerId: currentPlayerId,
          playerName: player?.name,
          players: getPlayersSnapshot(currentRoomId).map(p => ({
            id: p.id, name: p.name, number: p.number, isHost: p.isHost, alive: p.alive
          }))
        });
        if (room.players.size === 0) {
          rooms.delete(currentRoomId);
        }
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`========================================`);
  console.log(`谁是卧底服务器已启动`);
  console.log(`端口: ${PORT}`);
  console.log(`环境: ${process.env.NODE_ENV || 'development'}`);
  console.log(`词库版本: ${words.version}`);
  console.log(`词库数量: ${words.easy.length + words.normal.length + words.hard.length}`);
  console.log(`========================================`);
});
