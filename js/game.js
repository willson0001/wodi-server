(function() {
  const App = {
    socket: null,
    state: {
      playerId: null,
      roomId: null,
      playerName: null,
      isHost: false,
      phase: 'loading',
      round: 0,
      status: 'loading',
      players: [],
      myWord: null,
      myRole: null,
      lastEliminated: null,
      votedFor: null,
      votesReceived: 0,
      voteResult: null,
      eliminated: null,
      isTie: false,
      gameResult: null,
      hostOfflineWarning: false
    },
    heartbeatTimer: null,
    init() {
      this.bindEvents();
      this.bindWindowEvents();
      const params = new URLSearchParams(window.location.search);
      const roomParam = params.get('room');
      if (roomParam) {
        this.showPage('join');
        setTimeout(() => {
          const roomIdInput = document.getElementById('join-room-id');
          if (roomIdInput) {
            roomIdInput.value = roomParam.toUpperCase();
            roomIdInput.readOnly = true;
          }
        }, 100);
      } else {
        this.showPage('home');
      }
    },
    bindWindowEvents() {
      window.addEventListener('beforeunload', () => {
        if (this.socket && this.state.roomId) {
          this.socket.emit('LEAVE_ROOM', { roomId: this.state.roomId });
        }
      });
      document.addEventListener('visibilitychange', () => {
        if (document.hidden && this.socket && this.state.roomId) {
          this.socket.emit('LEAVE_ROOM', { roomId: this.state.roomId });
        }
      });
    },
    bindEvents() {
      document.getElementById('btn-create-room').addEventListener('click', () => this.showPage('create'));
      document.getElementById('btn-join-room').addEventListener('click', () => this.showPage('join'));
      document.getElementById('btn-back-home').addEventListener('click', () => this.showPage('home'));
      document.getElementById('btn-back-home-join').addEventListener('click', () => this.showPage('home'));
      document.getElementById('btn-confirm-create').addEventListener('click', () => this.createRoom());
      document.getElementById('btn-confirm-join').addEventListener('click', () => this.joinRoom());
      document.getElementById('btn-start-game').addEventListener('click', () => this.startGame());
      document.getElementById('btn-set-phase-describe').addEventListener('click', () => this.setPhase('describe'));
      document.getElementById('btn-set-phase-vote').addEventListener('click', () => this.setPhase('vote'));
      document.getElementById('btn-next-round').addEventListener('click', () => this.nextRound());
      document.getElementById('btn-restart-vote').addEventListener('click', () => this.restartVote());
      document.getElementById('btn-takeover-host').addEventListener('click', () => this.takeOverHost());
      document.getElementById('btn-play-again').addEventListener('click', () => this.playAgain());
      document.getElementById('btn-back-to-home').addEventListener('click', () => this.backToHome());
      document.getElementById('btn-open-wordbank').addEventListener('click', () => this.openWordBank());
      document.getElementById('btn-back-from-wordbank').addEventListener('click', () => this.closeWordBank());
      document.getElementById('btn-update-words').addEventListener('click', () => this.updateWords());
      document.getElementById('btn-add-word-pair').addEventListener('click', () => this.addWordPair());
      document.querySelectorAll('.diff-btn').forEach(btn => {
        btn.addEventListener('click', () => this.selectDifficulty(btn.dataset.diff));
      });
    },
    showPage(name) {
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      const page = document.getElementById('page-' + name);
      if (page) {
        page.classList.add('active');
        page.classList.add('page-enter');
        setTimeout(() => page.classList.remove('page-enter'), 400);
      }
    },
    connect() {
      if (this.socket) {
        this.socket.disconnect();
      }
      this.socket = io(window.SERVER_URL, { transports: ['websocket', 'polling'] });
      this.socket.on('connect', () => this.onConnect());
      this.socket.on('disconnect', () => this.onDisconnect());
      this.socket.on('ROOM_CREATED', (data) => this.onRoomCreated(data));
      this.socket.on('ROOM_JOINED', (data) => this.onRoomJoined(data));
      this.socket.on('ERROR', (data) => this.showError(data.message));
      this.socket.on('PLAYER_JOINED', (data) => this.onPlayerJoined(data));
      this.socket.on('PLAYER_LEFT', (data) => this.onPlayerLeft(data));
      this.socket.on('PLAYER_OFFLINE', (data) => this.onPlayerOffline(data));
      this.socket.on('ROOM_STATE', (data) => this.onRoomState(data));
      this.socket.on('GAME_STARTED', (data) => this.onGameStarted(data));
      this.socket.on('PHASE_CHANGED', (data) => this.onPhaseChanged(data));
      this.socket.on('VOTE_RECEIVED', (data) => this.onVoteReceived(data));
      this.socket.on('VOTE_RESULT', (data) => this.onVoteResult(data));
      this.socket.on('NEXT_ROUND_START', (data) => this.onNextRoundStart(data));
      this.socket.on('PLAYER_ELIMINATED', (data) => this.onPlayerEliminated(data));
      this.socket.on('GAME_OVER', (data) => this.onGameOver(data));
      this.socket.on('HOST_CHANGED', (data) => this.onHostChanged(data));
      this.socket.on('HOST_OFFLINE_WARNING', () => this.onHostOfflineWarning());
      this.socket.on('ROOM_CLOSED', () => this.onRoomClosed());
      this.socket.on('GAME_RESTARTED', (data) => this.onGameRestarted(data));
      this.socket.on('FETCH_WORDS_RESULT', (data) => this.onFetchWordsResult(data));
      this.socket.on('KICKED', () => this.onKicked());
      this.socket.on('PING', () => {});
    },
    onConnect() {
      console.log('Connected to server');
    },
    onDisconnect() {
      console.log('Disconnected from server');
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      this.socket = null;
    },
    startHeartbeat() {
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = setInterval(() => {
        if (this.socket && this.state.roomId) {
          this.socket.emit('HEARTBEAT', { roomId: this.state.roomId });
        }
      }, 30000);
    },
    createRoom() {
      const name = document.getElementById('create-name').value.trim();
      const diffBtns = document.querySelectorAll('.diff-btn.selected');
      if (!name) { this.showError('请输入昵称'); return; }
      const difficulty = diffBtns.length > 0 ? diffBtns[0].dataset.diff : 'normal';
      this.state.playerName = name;
      this.connect();
      this.socket.emit('CREATE_ROOM', { name, difficulty });
    },
    onRoomCreated(data) {
      this.state.playerId = data.playerId;
      this.state.roomId = data.roomId;
      this.state.isHost = true;
      this.state.phase = 'waiting';
      this.state.status = 'waiting';
      this.state.players = [data.player];
      this.startHeartbeat();
      this.renderWaitingRoom();
      this.showPage('waiting');
    },
    joinRoom() {
      const name = document.getElementById('join-name').value.trim();
      const roomId = document.getElementById('join-room-id').value.trim().toUpperCase();
      if (!name) { this.showError('请输入昵称'); return; }
      if (!roomId || roomId.length !== 4) { this.showError('请输入4位房间号'); return; }
      this.state.playerName = name;
      this.connect();
      this.socket.emit('JOIN_ROOM', { name, roomId });
    },
    onRoomJoined(data) {
      this.state.playerId = data.playerId;
      this.state.roomId = data.roomId;
      this.state.isHost = data.player.isHost;
      this.state.phase = 'waiting';
      this.state.status = 'waiting';
      this.state.players = [data.player];
      this.startHeartbeat();
      this.renderWaitingRoom();
      this.showPage('waiting');
    },
    onRoomState(data) {
      this.state.roomId = data.roomId;
      this.state.phase = data.phase;
      this.state.round = data.round;
      this.state.status = data.status;
      this.state.lastEliminated = data.lastEliminated;
      if (data.myWord !== undefined && data.myWord !== null) {
        this.state.myWord = data.myWord;
        this.state.myRole = data.myRole;
      }
      if (data.players) {
        this.state.players = data.players;
      }
      this.renderCurrentPage();
    },
    onPlayerJoined(data) {
      this.state.players = data.players;
      this.renderPlayerList();
    },
    onPlayerLeft(data) {
      this.state.players = data.players;
      this.renderPlayerList();
    },
    onPlayerOffline(data) {
      const player = this.state.players.find(p => p.id === data.playerId);
      if (player) player.online = false;
      this.renderPlayerList();
    },
    startGame() {
      if (!this.state.isHost) return;
      if (this.state.players.length < 4) {
        this.showError('至少需要4人才能开始');
        return;
      }
      this.socket.emit('START_GAME');
    },
    onGameStarted(data) {
      console.log('GAME_STARTED myWord:', data.myWord, '| players:', data.players.length);
      this.state.phase = 'describe';
      this.state.round = data.round;
      this.state.status = 'playing';
      this.state.myWord = data.myWord;
      this.state.myRole = null;
      this.state.players = data.players;
      this.state.votedFor = null;
      this.state.voteResult = null;
      this.state.eliminated = null;
      this.state.isTie = false;
      this.state.hostOfflineWarning = false;
      this.renderGamePage();
      this.showPage('game');
    },
    setPhase(phase) {
      if (!this.state.isHost) return;
      this.socket.emit('SET_PHASE', { phase });
    },
    onPhaseChanged(data) {
      this.state.phase = data.phase;
      this.state.round = data.round;
      if (data.isRestart) {
        this.state.votedFor = null;
        this.state.voteResult = null;
        this.state.eliminated = null;
        this.state.isTie = false;
      }
      this.renderGamePage();
    },
    castVote(targetId) {
      if (this.state.phase !== 'vote') return;
      if (this.state.votedFor) return;
      if (targetId === this.state.playerId) return;
      const target = this.state.players.find(p => p.id === targetId);
      if (!target || !target.alive) return;
      this.socket.emit('VOTE', { targetId });
      this.state.votedFor = targetId;
      this.renderVotePanel();
    },
    onVoteReceived(data) {
      this.state.votesReceived = data.totalAlive;
      this.renderVoteProgress();
    },
    onVoteResult(data) {
      this.state.voteResult = data.votes;
      this.state.eliminated = data.eliminated;
      this.state.isTie = data.isTie;
      this.state.players = data.players;
      this.state.votedFor = null;
      this.state.votesReceived = 0;
      this.renderVoteResult();
    },
    nextRound() {
      if (!this.state.isHost) return;
      this.socket.emit('NEXT_ROUND');
    },
    onNextRoundStart(data) {
      this.state.round = data.round;
      this.state.phase = data.phase;
      this.state.votedFor = null;
      this.state.voteResult = null;
      this.state.eliminated = null;
      this.state.isTie = false;
      this.renderGamePage();
    },
    restartVote() {
      if (!this.state.isHost) return;
      this.socket.emit('RESTART_VOTE');
    },
    onPlayerEliminated(data) {
      this.state.eliminated = data;
      this.state.players = this.state.players.map(p =>
        p.id === data.id ? { ...p, alive: false } : p
      );
      this.renderGamePage();
    },
    onGameOver(data) {
      this.state.status = 'finished';
      this.state.phase = 'finished';
      this.state.gameResult = data.result;
      this.state.players = data.players;
      this.state.myRole = this.state.players.find(p => p.id === this.state.playerId)?.role || null;
      this.renderGameOver();
      this.showPage('game-over');
    },
    takeOverHost() {
      if (!this.state.isHost) return;
      this.socket.emit('TAKE_OVER_HOST');
    },
    onHostChanged(data) {
      this.state.isHost = (data.newHostId === this.state.playerId);
      this.state.hostOfflineWarning = false;
      this.state.players = this.state.players.map(p => ({
        ...p,
        isHost: p.id === data.newHostId
      }));
      document.getElementById('host-offline-bar')?.classList.remove('show');
      this.renderGamePage();
    },
    onHostOfflineWarning() {
      this.state.hostOfflineWarning = true;
      this.renderHostOfflineBar();
    },
    onRoomClosed() {
      this.showError('房间已关闭');
      this.backToHome();
    },
    playAgain() {
      if (!this.state.isHost) return;
      this.socket.emit('RESTART_GAME');
    },
    kickPlayer(targetId) {
      if (!this.state.isHost) return;
      this.socket.emit('KICK_PLAYER', { targetId });
    },
    reassignWords() {
      if (!this.state.isHost) return;
      this.socket.emit('REASSIGN_WORDS');
    },
    onKicked() {
      this.showError('你已被法官移出房间');
      this.backToHome();
    },
    onGameRestarted(data) {
      this.state.status = 'waiting';
      this.state.phase = 'waiting';
      this.state.round = 0;
      this.state.myWord = null;
      this.state.myRole = null;
      this.state.eliminated = null;
      this.state.isTie = false;
      this.state.gameResult = null;
      this.state.votedFor = null;
      this.state.players = data.players;
      this.startHeartbeat();
      this.renderWaitingRoom();
      this.showPage('waiting');
    },
    backToHome() {
      if (this.socket) {
        this.socket.disconnect();
        this.socket = null;
      }
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
      this.state = {
        playerId: null, roomId: null, playerName: null,
        isHost: false, phase: 'loading', round: 0, status: 'loading',
        players: [], myWord: null, myRole: null, lastEliminated: null,
        votedFor: null, votesReceived: 0, voteResult: null,
        eliminated: null, isTie: false, gameResult: null, hostOfflineWarning: false
      };
      this.showPage('home');
      window.history.replaceState({}, '', window.location.pathname);
    },
    renderWaitingRoom() {
      const roomId = this.state.roomId;
      const isHost = this.state.isHost;
      let html = `
        <div class="page active" id="page-waiting">
          <div class="card fade-in" style="text-align:center">
            <h2 style="margin-bottom:8px">房间已创建</h2>
            <p style="color:var(--text2);font-size:14px;margin-bottom:16px">邀请朋友加入游戏</p>
            <div style="background:var(--card2);border-radius:12px;padding:20px;margin-bottom:16px">
              <p style="color:var(--text2);font-size:13px;margin-bottom:8px">房间号</p>
              <p style="font-size:40px;font-weight:800;letter-spacing:12px;color:var(--accent)">${roomId}</p>
            </div>
            <p style="color:var(--text2);font-size:13px">将链接发到微信群：</p>
            <p style="font-size:12px;color:var(--primary);word-break:break-all;background:var(--card2);padding:10px;border-radius:8px;margin-top:8px">${window.location.href}</p>
          </div>
          <div class="card fade-in">
            <h3 style="margin-bottom:12px">等待玩家加入（${this.state.players.length}人）</h3>
            <div id="waiting-player-list" class="player-list"></div>
          </div>
          <div id="waiting-error"></div>
          ${isHost ? `
          <button class="btn btn-primary" id="btn-start-game" ${this.state.players.length < 4 ? 'disabled' : ''}>
            ${this.state.players.length < 4 ? `还需 ${4 - this.state.players.length} 人` : '开始游戏'}
          </button>
          ` : `
          <div class="waiting-hint" style="text-align:center;color:var(--text2);font-size:14px;padding:16px">
            ⏳ 等待法官${this.state.players.length < 4 ? `（还差 ${4 - this.state.players.length} 人）` : '开始游戏'}...
          </div>
          `}
        </div>
      `;
      const oldWaiting = document.getElementById('page-waiting');
      if (oldWaiting) oldWaiting.remove();
      document.getElementById('app').insertAdjacentHTML('beforeend', html);
      if (isHost) {
        document.getElementById('btn-start-game')?.addEventListener('click', () => this.startGame());
      }
      this.renderWaitingPlayerList();
    },
    renderWaitingPlayerList() {
      const list = document.getElementById('waiting-player-list');
      if (!list) return;
      list.innerHTML = this.state.players.map(p => {
        const isMe = p.id === this.state.playerId;
        const canKick = this.state.isHost && !isMe;
        return `
          <div class="player-item ${isMe ? 'self' : ''}">
            <div class="avatar ${p.isHost ? 'host' : ''}">${p.number}</div>
            <div class="info">
              <div class="name">${this.escapeHtml(p.name)}</div>
              <div class="sub">${isMe ? '（你）' : ''} ${p.isHost ? '<span class="badge host">法官</span>' : ''}</div>
            </div>
            ${canKick ? `<button class="btn-kick" onclick="App.kickPlayer('${p.id}')">踢</button>` : ''}
          </div>
        `;
      }).join('');

      const title = document.querySelector('#page-waiting h3');
      if (title) {
        title.textContent = `等待玩家加入（${this.state.players.length}人）`;
      }

      const btn = document.getElementById('btn-start-game');
      if (btn) {
        btn.disabled = this.state.players.length < 4;
        if (this.state.players.length < 4) {
          btn.textContent = `还需 ${4 - this.state.players.length} 人`;
        } else {
          btn.textContent = '开始游戏';
        }
      } else {
        const waitingHint = document.querySelector('#page-waiting .waiting-hint');
        if (waitingHint) {
          const remain = 4 - this.state.players.length;
          waitingHint.innerHTML = remain > 0
            ? `⏳ 等待法官（还差 ${remain} 人）...`
            : '⏳ 等待法官开始游戏...';
        }
      }
    },
    renderCurrentPage() {
      if (this.state.status === 'waiting') {
        this.renderWaitingRoom();
        this.showPage('waiting');
      } else if (this.state.status === 'playing') {
        this.renderGamePage();
        this.showPage('game');
      }
    },
    renderGamePage() {
      const players = this.state.players;
      const alivePlayers = players.filter(p => p.alive);
      const deadPlayers = players.filter(p => !p.alive);
      const isHost = this.state.isHost;
      const phase = this.state.phase;
      const round = this.state.round;
      const word = this.state.myWord;
      let phaseLabel = '等待中';
      let phaseClass = '';
      if (phase === 'describe') { phaseLabel = '描述阶段'; phaseClass = 'describe'; }
      if (phase === 'vote') { phaseLabel = '投票阶段'; phaseClass = 'vote'; }

      let wordArea = `
        <div class="word-display">
          <p style="color:var(--text2);font-size:13px;margin-bottom:8px">你的词语是</p>
          <div class="word${word ? '' : ' masked'}" id="word-masked">${word || '长按查看'}</div>
          ${!word ? '<p class="hint">长按屏幕显示词语，松开隐藏</p>' : ''}
        </div>
      `;

      let actionArea = '';
      if (isHost) {
        actionArea = `
          <div style="display:flex;gap:10px;margin-top:12px">
            ${phase === 'describe' ? '<button class="btn btn-primary" id="btn-set-phase-vote">进入投票</button>' : ''}
            ${phase === 'vote' ? '<button class="btn btn-primary" disabled>等待投票...</button>' : ''}
            <button class="btn btn-ghost" id="btn-reassign-words">换词重开</button>
          </div>
        `;
      } else {
        actionArea = `
          <div class="waiting-hint">
            ${phase === 'describe' ? '⏳ 等待法官开始投票...' : ''}
            ${phase === 'vote' ? '⏳ 等待投票结果...' : ''}
          </div>
        `;
      }

      let voteProgress = '';
      if (phase === 'vote' && this.state.votedFor) {
        voteProgress = `
          <div class="progress-bar" style="margin-top:10px">
            <span>已投票</span>
            <div class="fill"><div class="fill-inner" style="width:100%"></div></div>
            <span>✓</span>
          </div>
        `;
      }

      let judgeWordInfo = '';
      if (isHost) {
        judgeWordInfo = `
          <div style="background:var(--card2);border-radius:10px;padding:12px;margin-top:10px;font-size:13px;color:var(--text2)">
            💡 你的词：${word || '?'}
          </div>
        `;
      }

      let html = `
        <div class="page active" id="page-game">
          <div class="card fade-in">
            ${isHost ? '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px"><span style="font-size:13px;color:var(--text2)">⚖️</span><span style="font-size:13px;color:var(--primary);font-weight:600">法官模式</span></div>' : ''}
            ${wordArea}
            ${judgeWordInfo}
            <div style="display:flex;align-items:center;justify-content:space-between;margin-top:12px">
              <span class="phase-badge ${phaseClass}">第${round}轮 · ${phaseLabel}</span>
            </div>
            ${actionArea}
            ${voteProgress}
          </div>
          ${this.renderPlayerListHTML(alivePlayers, deadPlayers, phase, this.state.status)}
        </div>
      `;

      const oldGame = document.getElementById('page-game');
      if (oldGame) oldGame.remove();
      const oldGameOver = document.getElementById('page-game-over');
      if (oldGameOver) oldGameOver.remove();
      document.getElementById('app').insertAdjacentHTML('beforeend', html);

      if (phase === 'vote') {
        this.renderVotePanel();
      }

      if (isHost) {
        document.getElementById('btn-set-phase-vote')?.addEventListener('click', () => this.setPhase('vote'));
        document.getElementById('btn-set-phase-describe')?.addEventListener('click', () => this.setPhase('describe'));
        document.getElementById('btn-next-round')?.addEventListener('click', () => this.nextRound());
        document.getElementById('btn-restart-vote')?.addEventListener('click', () => this.restartVote());
        document.getElementById('btn-reassign-words')?.addEventListener('click', () => this.reassignWords());
      }

      this.renderHostOfflineBar();
    },
    renderPlayerListHTML(alive, dead, phase, status) {
      const isHost = this.state.isHost;
      const meId = this.state.playerId;
      const canVote = (phase === 'vote') && !this.state.votedFor;
      const votedFor = this.state.votedFor;
      const voteResult = this.state.voteResult;
      const canKick = isHost && status === 'waiting';

      let aliveHtml = alive.map(p => {
        let classes = ['player-item'];
        if (p.id === meId) classes.push('self');
        if (p.id === votedFor) classes.push('voted');
        let right = '';
        if (canKick && p.id !== meId) {
          right = `<button class="btn-kick" onclick="App.kickPlayer('${p.id}')">踢</button>`;
        } else if (isHost && canVote && p.id !== meId) {
          right = '<span style="color:var(--primary);font-size:13px">点我投票</span>';
        } else if (!isHost && voteResult && voteResult[p.id]) {
          right = `<span class="vote-count">${voteResult[p.id]}票</span>`;
        }
        return `
          <div class="player-item ${classes.join(' ')}" data-id="${p.id}">
            <div class="avatar ${p.isHost ? 'host' : ''}">${p.number}</div>
            <div class="info">
              <div class="name">${this.escapeHtml(p.name)}</div>
              <div class="sub">${p.id === meId ? '（你）' : ''} ${p.isHost ? '<span class="badge host">法官</span>' : ''}</div>
            </div>
            ${right}
          </div>
        `;
      }).join('');

      let deadHtml = '';
      if (dead.length > 0) {
        deadHtml = dead.map(p => `
          <div class="player-item dead">
            <div class="avatar" style="opacity:0.5">${p.number}</div>
            <div class="info">
              <div class="name">${this.escapeHtml(p.name)}</div>
              <div class="sub"><span class="badge dead">已淘汰</span></div>
            </div>
          </div>
        `).join('');
      }

      return `
        <div class="card fade-in">
          <div class="section-title">
            <h3>存活玩家（${alive.length}人）</h3>
          </div>
          <div id="alive-player-list" class="player-list">${aliveHtml}</div>
          ${deadHtml ? `
            <div class="section-title" style="margin-top:16px">
              <h3>已淘汰（${dead.length}人）</h3>
            </div>
            <div class="player-list">${deadHtml}</div>
          ` : ''}
        </div>
      `;
    },
    renderVotePanel() {
      const players = this.state.players;
      const alive = players.filter(p => p.alive);
      const meId = this.state.playerId;
      const votedFor = this.state.votedFor;

      document.querySelectorAll('#alive-player-list .player-item').forEach(item => {
        const id = item.dataset.id;
        const p = players.find(pl => pl.id === id);
        if (!p || !p.alive) return;
        if (id === meId) {
          item.classList.add('disabled');
          item.style.cursor = 'not-allowed';
          return;
        }
        if (votedFor) {
          item.classList.add('disabled');
          return;
        }
        item.classList.add('clickable');
        item.addEventListener('click', () => this.castVote(id));
      });
    },
    renderVoteProgress() {
      const alive = this.state.players.filter(p => p.alive);
      const total = alive.length;
      let voted = this.state.votedFor ? 1 : 0;
      voted += alive.filter(p => p.votedFor && p.id !== this.state.playerId).length;
      let progressEl = document.getElementById('vote-progress');
      if (!progressEl) {
        const gameCard = document.querySelector('#page-game .card:first-child');
        if (gameCard) {
          gameCard.insertAdjacentHTML('beforeend', `<div id="vote-progress" class="progress-bar"><span>投票进度</span><div class="fill"><div class="fill-inner" style="width:0%"></div></div><span>0/${total}</span></div>`);
          progressEl = document.getElementById('vote-progress');
        }
      }
      if (progressEl) {
        const pct = Math.round((voted / total) * 100);
        progressEl.querySelector('.fill-inner').style.width = pct + '%';
        progressEl.querySelector('span:last-child').textContent = `${voted}/${total}`;
      }
    },
    renderVoteResult() {
      if (!this.state.voteResult) return;
      const players = this.state.players;
      const votes = this.state.voteResult;
      const eliminated = this.state.eliminated;
      const isTie = this.state.isTie;
      const isHost = this.state.isHost;

      const sorted = Object.entries(votes).sort((a, b) => b[1] - a[1]);
      const maxVotes = sorted[0] ? sorted[0][1] : 0;

      let html = `
        <div id="vote-result-overlay" class="result-overlay" style="position:relative;background:transparent;padding:0">
          <div class="result-box" style="padding:24px">
            <h2 style="margin-bottom:16px">投票结果</h2>
            <div class="vote-results">
              ${sorted.map(([pid, cnt]) => {
                const p = players.find(pl => pl.id === pid);
                if (!p) return '';
                const isHighest = cnt === maxVotes;
                return `
                  <div class="vote-bar" style="margin-bottom:10px">
                    <span class="label">${p.number}号 ${this.escapeHtml(p.name)}</span>
                    <div class="bar"><div class="bar-fill" style="width:${(cnt / maxVotes) * 100}%"></div></div>
                    <span class="count">${cnt}票</span>
                  </div>
                `;
              }).join('')}
            </div>
            ${isTie ? `
              <div class="tie-hint">⚠️ 平票！无人淘汰</div>
              ${isHost ? `<button class="btn btn-primary" id="btn-restart-vote" style="margin-top:16px">重新投票</button>` : '<p style="color:var(--text2);margin-top:12px;font-size:14px">等待法官操作...</p>'}
            ` : eliminated ? `
              <p style="margin-top:16px;color:var(--danger);font-weight:600">
                💀 ${eliminated.number}号 ${this.escapeHtml(eliminated.name)} 被淘汰
              </p>
              <p style="color:var(--text2);font-size:13px;margin-top:4px">（身份不公开）</p>
              ${isHost ? `<button class="btn btn-primary" id="btn-next-round" style="margin-top:16px">${this.state.round >= 3 ? '查看结果' : '下一轮'}</button>` : ''}
            ` : ''}
          </div>
        </div>
      `;

      let overlay = document.getElementById('vote-result-overlay');
      if (overlay) overlay.remove();
      const gamePage = document.getElementById('page-game');
      if (gamePage) {
        gamePage.insertAdjacentHTML('beforeend', html);
        document.getElementById('btn-restart-vote')?.addEventListener('click', () => this.restartVote());
        document.getElementById('btn-next-round')?.addEventListener('click', () => this.nextRound());
      }
    },
    renderGameOver() {
      const players = this.state.players;
      const result = this.state.gameResult;
      const isWin = result === 'civilian_win';
      const isHost = this.state.isHost;

      const sortedPlayers = [...players].sort((a, b) => a.number - b.number);

      let html = `
        <div class="page" id="page-game-over">
          <div class="result-overlay" style="position:relative;background:transparent;padding:0">
            <div class="result-box fade-in">
              <div class="result-title ${isWin ? 'win' : 'lose'}">${isWin ? '🎉 平民胜利！' : '🕵️ 卧底胜利！'}</div>
              <p class="result-sub">游戏结束 · 身份揭示</p>
              <div style="text-align:left;margin:20px 0">
                ${sortedPlayers.map(p => `
                  <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
                    <span style="font-size:15px;font-weight:600;min-width:60px">${p.number}号</span>
                    <span style="flex:1">${this.escapeHtml(p.name)}</span>
                    <span style="font-size:13px;padding:2px 8px;border-radius:8px;background:${p.role === 'spy' ? 'rgba(233,69,96,0.2)' : 'rgba(74,222,128,0.2)'};color:${p.role === 'spy' ? 'var(--primary)' : 'var(--success)'}">${p.role === 'spy' ? '卧底' : '平民'}</span>
                    <span style="font-size:13px;color:var(--text2)">${p.word}</span>
                    ${!p.alive ? '<span style="color:var(--danger)">💀</span>' : ''}
                  </div>
                `).join('')}
              </div>
              ${isHost ? `
                <button class="btn btn-primary" id="btn-play-again">再来一局</button>
              ` : ''}
            </div>
          </div>
        </div>
      `;

      let oldOver = document.getElementById('page-game-over');
      if (oldOver) oldOver.remove();
      document.getElementById('app').insertAdjacentHTML('beforeend', html);
      if (isHost) {
        document.getElementById('btn-play-again')?.addEventListener('click', () => this.playAgain());
      }
    },
    renderHostOfflineBar() {
      let bar = document.getElementById('host-offline-bar');
      if (!bar) {
        document.body.insertAdjacentHTML('beforeend', '<div id="host-offline-bar" class="host-offline-warning">⚠️ 法官已离线，是否接管？<button onclick="App.takeOverHost()" style="background:#000;color:#ffd93d;border:none;padding:4px 12px;border-radius:6px;margin-left:10px;font-weight:600;cursor:pointer">接管</button></div>');
        bar = document.getElementById('host-offline-bar');
      }
      if (this.state.hostOfflineWarning && !this.state.isHost) {
        bar.classList.add('show');
      } else {
        bar.classList.remove('show');
      }
    },
    openWordBank() {
      this.showPage('wordbank');
      this.socket.emit('FETCH_WORDS');
    },
    closeWordBank() {
      this.showPage('waiting');
    },
    updateWords() {
      const url = document.getElementById('remote-words-url').value.trim();
      if (!url) return;
      this.socket.emit('FETCH_WORDS', { url });
    },
    onFetchWordsResult(data) {
      let msg = document.getElementById('words-result-msg');
      if (!msg) return;
      if (data.success) {
        msg.className = 'success-msg';
        msg.textContent = `✅ 更新成功！共 ${data.count} 组词语`;
      } else {
        msg.className = 'error-msg';
        msg.textContent = `❌ 更新失败：${data.error}`;
      }
    },
    addWordPair() {
      const wordA = document.getElementById('add-word-a').value.trim();
      const wordB = document.getElementById('add-word-b').value.trim();
      if (!wordA || !wordB) {
        this.showError('请输入两个词语');
        return;
      }
      if (this.socket && this.socket.connected) {
        this.socket.emit('ADD_WORD_PAIR', { wordA, wordB });
      }
      let msg = document.getElementById('words-result-msg');
      if (msg) {
        msg.className = 'success-msg';
        msg.style.display = 'block';
        msg.textContent = '✅ 已发送添加请求';
      }
      document.getElementById('add-word-a').value = '';
      document.getElementById('add-word-b').value = '';
    },
    selectDifficulty(diff) {
      document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('selected'));
      document.querySelector(`.diff-btn[data-diff="${diff}"]`).classList.add('selected');
    },
    renderPlayerList() {
      this.state.players = this.state.players;
      if (document.getElementById('waiting-player-list')) {
        this.renderWaitingPlayerList();
      }
    },
    showError(msg) {
      let errEl = document.getElementById('global-error');
      if (!errEl) {
        document.getElementById('app').insertAdjacentHTML('afterbegin', '<div id="global-error" class="error-msg" style="margin-bottom:16px"></div>');
        errEl = document.getElementById('global-error');
      }
      errEl.textContent = msg;
      errEl.style.display = 'block';
      setTimeout(() => { errEl.style.display = 'none'; }, 3000);
    },
    escapeHtml(str) {
      if (!str) return '';
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
  };

  window.App = App;
  App.init();
})();
