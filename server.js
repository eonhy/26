const express = require("express");
const fs = require("fs");
const http = require("http");
const https = require("https");
const os = require("os");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;
const DURATION = (Number(process.env.DURATION_SEC) || 600) * 1000; // 채팅 시간 (기본 10분)
const CHOICE_WINDOW = 30 * 1000;                                    // 선택 제한 시간 30초
const NO_REMATCH = process.env.NO_REMATCH === "1";                  // 1이면 만난 적 있는 사람과 재매칭 방지

const app = express();
// certs/key.pem, certs/cert.pem 이 있으면 HTTPS(TLS, 6계층)로 실행
const useTLS = fs.existsSync("certs/key.pem") && fs.existsSync("certs/cert.pem");
const proto = useTLS ? "https" : "http";
const server = useTLS
  ? https.createServer({ key: fs.readFileSync("certs/key.pem"), cert: fs.readFileSync("certs/cert.pem") }, app)
  : http.createServer(app);
const io = new Server(server);
app.use(express.static("public"));

const log = (layer, msg) =>
  console.log(`[${new Date().toLocaleTimeString()}] [${layer}] ${msg}`);

// 1~3계층 정보: 서버 PC의 네트워크 인터페이스(이름, IP, MAC)
function lanInfo() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const i of list) {
      if ((i.family === "IPv4" || i.family === 4) && !i.internal) {
        out.push({ name, ip: i.address, mac: i.mac });
      }
    }
  }
  return out;
}
app.get("/info", (req, res) => res.json({ port: PORT, interfaces: lanInfo() }));

// ---------- 상태 (메모리) ----------
const queue = [];          // 매칭 대기 중인 socket
const nicks = new Set();   // 사용 중인 닉네임
const friends = new Map(); // 닉네임 -> Set(친구 닉네임)
const met = new Map();     // 닉네임 -> Set(만난 적 있는 닉네임)

const hasMet = (a, b) => met.get(a)?.has(b);
function remember(a, b) {
  for (const [x, y] of [[a, b], [b, a]]) {
    if (!met.has(x)) met.set(x, new Set());
    met.get(x).add(y);
  }
}
function addFriend(a, b) {
  for (const [x, y] of [[a, b], [b, a]]) {
    if (!friends.has(x)) friends.set(x, new Set());
    friends.get(x).add(y);
  }
}
function removeFromQueue(socket) {
  const i = queue.findIndex((s) => s.id === socket.id);
  if (i !== -1) queue.splice(i, 1);
}

// ---------- 매칭 / 방 ----------
function tryMatch(socket) {
  const me = socket.data.nick;
  const idx = queue.findIndex(
    (o) => o.id !== socket.id && !(NO_REMATCH && hasMet(me, o.data.nick))
  );
  if (idx === -1) {
    queue.push(socket);
    socket.emit("waiting");
    log("7 응용", `${me} 대기열 진입 (대기 ${queue.length}명)`);
    return;
  }
  const [other] = queue.splice(idx, 1);
  startRoom(other, socket);
}

function startRoom(a, b) {
  const room = {
    sockets: [a, b],
    phase: "chat",
    choices: new Map(),
    timers: [],
    endsAt: Date.now() + DURATION,
  };
  a.data.room = room;
  b.data.room = room;
  for (const [me, you] of [[a, b], [b, a]]) {
    me.emit("matched", { partner: you.data.nick, endsAt: room.endsAt, now: Date.now() });
  }
  room.timers.push(setTimeout(() => toChoicePhase(room), DURATION));
  log("7 응용", `매칭: ${a.data.nick} ↔ ${b.data.nick} (${DURATION / 1000}초)`);
}

function toChoicePhase(room) {
  room.phase = "choice";
  for (const s of room.sockets) s.emit("time_up", { window: CHOICE_WINDOW / 1000 });
  room.timers.push(setTimeout(() => finish(room), CHOICE_WINDOW));
  log("7 응용", "채팅 시간 종료 → 선택 단계");
}

function finish(room) {
  if (room.phase === "done") return;
  room.phase = "done";
  room.timers.forEach(clearTimeout);
  const [a, b] = room.sockets;
  const both = room.choices.get(a.id) === true && room.choices.get(b.id) === true;
  remember(a.data.nick, b.data.nick);
  if (both) addFriend(a.data.nick, b.data.nick);
  for (const [me, you] of [[a, b], [b, a]]) {
    me.emit("result", { friend: both, partner: you.data.nick });
    me.data.room = null;
  }
  log("7 응용", `결과: ${a.data.nick}, ${b.data.nick} → ${both ? "친구 추가" : "종료"}`);
}

// ---------- 소켓 이벤트 ----------
io.on("connection", (socket) => {
  const ip = (socket.handshake.address || "").replace("::ffff:", "");
  const port = socket.request.socket.remotePort;
  const cipher = socket.request.socket.getCipher ? socket.request.socket.getCipher() : null;
  log("6 표현", cipher ? `TLS 암호화 사용 (${cipher.version}, ${cipher.name})` : "암호화 없음 (JSON + UTF-8 평문)");
  log("3 네트워크", `클라이언트 IP: ${ip}`);
  log("4 전송", `TCP 클라이언트 포트 ${port} → 서버 포트 ${PORT}`);
  log("5 세션", `세션 ID: ${socket.id}, 전송 방식: ${socket.conn.transport.name}`);
  socket.conn.on("upgrade", (t) =>
    log("5 세션", `${socket.id} 전송 방식 변경 → ${t.name}`)
  );

  socket.on("login", (nick, cb) => {
    nick = String(nick || "").trim().slice(0, 12);
    if (!nick) return cb({ ok: false, error: "닉네임을 입력해 주세요." });
    if (nicks.has(nick)) return cb({ ok: false, error: "이미 사용 중인 닉네임이에요." });
    if (socket.data.nick) nicks.delete(socket.data.nick);
    socket.data.nick = nick;
    nicks.add(nick);
    cb({ ok: true, nick });
  });

  socket.on("find", () => {
    if (!socket.data.nick || socket.data.room) return;
    if (queue.some((s) => s.id === socket.id)) return;
    tryMatch(socket);
  });

  socket.on("cancel", () => removeFromQueue(socket));

  socket.on("message", (text) => {
    const room = socket.data.room;
    if (!room || room.phase !== "chat") return;
    text = String(text || "").trim().slice(0, 500);
    if (!text) return;
    const other = room.sockets.find((s) => s.id !== socket.id);
    other.emit("message", { text });
  });

  socket.on("choice", (like) => {
    const room = socket.data.room;
    if (!room || room.phase !== "choice") return;
    room.choices.set(socket.id, like === true);
    if (room.choices.size === 2) finish(room);
  });

  socket.on("friends", (cb) => {
    cb([...(friends.get(socket.data.nick) || [])]);
  });

  socket.on("disconnect", (reason) => {
    log("4 전송", `연결 종료 (${reason}) 세션 ${socket.id}`);
    removeFromQueue(socket);
    const room = socket.data.room;
    if (room && room.phase !== "done") {
      room.phase = "done";
      room.timers.forEach(clearTimeout);
      for (const s of room.sockets) {
        if (s.id !== socket.id) {
          s.emit("partner_left");
          s.data.room = null;
        }
      }
    }
    if (socket.data.nick) nicks.delete(socket.data.nick);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  log("4 전송", `서버 시작: ${proto.toUpperCase()} TCP 포트 ${PORT}, 채팅 시간 ${DURATION / 1000}초`);
  log("1 물리", "서버 PC 네트워크 인터페이스 목록");
  for (const i of lanInfo()) {
    log("2 데이터 링크", `${i.name} MAC ${i.mac}`);
    log("3 네트워크", `${i.name} 접속 주소 ${proto}://${i.ip}:${PORT}`);
  }
});
