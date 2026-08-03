const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
    let filePath = req.url === '/' ? '/index.html' : req.url;
    filePath = path.join(__dirname, filePath);
    const ext = path.extname(filePath).toLowerCase();
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
    const contentType = types[ext] || 'application/octet-stream';
    fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': contentType + '; charset=utf-8' });
        res.end(data);
    });
});

const wss = new WebSocketServer({ server });

const rooms = {};
const clientRoom = {};
const clientId = {};

function genCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let c = '';
    for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
    return rooms[c] ? genCode() : c;
}

function broadcastPlayers(code) {
    const room = rooms[code];
    if (!room) return;
    const msg = JSON.stringify({ type: 'players_update', players: room.players });
    room.players.forEach(p => {
        if (p.ws && p.ws.readyState === 1) p.ws.send(msg);
    });
}

function cleanupRoom(code) {
    const room = rooms[code];
    if (!room) return;
    if (room.players.length === 0) {
        delete rooms[code];
        return;
    }
    const hostGone = !room.players.find(p => p.id === room.hostId);
    if (hostGone) {
        room.players.forEach(p => {
            if (p.ws && p.ws.readyState === 1) {
                p.ws.send(JSON.stringify({ type: 'room_closed' }));
                clientRoom.delete(p.id);
            }
        });
        delete rooms[code];
    }
}

wss.on('connection', (ws) => {
    let myId = Math.random().toString(36).slice(2, 10);
    clientId.set(ws, myId);

    ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch (e) { return; }
        const cid = clientId.get(ws);

        if (msg.type === 'create_room') {
            const code = genCode();
            const name = (msg.name || 'Гравець').slice(0, 20);
            rooms[code] = {
                hostId: cid,
                players: [{ id: cid, name, ws }],
                state: null,
                stateHash: 0,
                actions: {}
            };
            clientRoom.set(cid, { code, role: 'host' });
            ws.send(JSON.stringify({ type: 'room_created', code }));
            broadcastPlayers(code);
        }

        else if (msg.type === 'join_room') {
            const code = (msg.code || '').toUpperCase().trim();
            const room = rooms[code];
            if (!room) { ws.send(JSON.stringify({ type: 'error', message: 'Кімнату не знайдено' })); return; }
            if (room.players.length >= 8) { ws.send(JSON.stringify({ type: 'error', message: 'Кімната заповнена' })); return; }
            const name = (msg.name || 'Гравець').slice(0, 20);
            room.players.push({ id: cid, name, ws });
            clientRoom.set(cid, { code, role: 'guest' });
            ws.send(JSON.stringify({ type: 'room_joined', players: room.players.map(p => ({ id: p.id, name: p.name })), hostId: room.hostId }));
            broadcastPlayers(code);
            if (room.state) {
                ws.send(JSON.stringify({ type: 'host_state', state: room.state, hash: room.stateHash }));
            }
        }

        else if (msg.type === 'leave_room') {
            const info = clientRoom.get(cid);
            if (!info) return;
            const room = rooms[info.code];
            if (room) {
                room.players = room.players.filter(p => p.id !== cid);
                cleanupRoom(info.code);
                broadcastPlayers(info.code);
            }
            clientRoom.delete(cid);
        }

        else if (msg.type === 'kick_player') {
            const info = clientRoom.get(cid);
            if (!info || info.role !== 'host') return;
            const room = rooms[info.code];
            if (!room) return;
            const target = room.players.find(p => p.id === msg.playerId);
            if (target && target.id !== room.hostId) {
                if (target.ws && target.ws.readyState === 1) {
                    target.ws.send(JSON.stringify({ type: 'kicked' }));
                    clientRoom.delete(target.id);
                }
                room.players = room.players.filter(p => p.id !== msg.playerId);
                cleanupRoom(info.code);
                broadcastPlayers(info.code);
            }
        }

        else if (msg.type === 'host_state') {
            const info = clientRoom.get(cid);
            if (!info || info.role !== 'host') return;
            const room = rooms[info.code];
            if (!room) return;
            room.state = msg.state;
            room.stateHash = msg.hash || 0;
            const stateMsg = JSON.stringify({ type: 'host_state', state: msg.state, hash: msg.hash });
            room.players.forEach(p => {
                if (p.id !== room.hostId && p.ws && p.ws.readyState === 1) {
                    p.ws.send(stateMsg);
                }
            });
        }

        else if (msg.type === 'guest_action') {
            const info = clientRoom.get(cid);
            if (!info || info.role !== 'guest') return;
            const room = rooms[info.code];
            if (!room) return;
            const host = room.players.find(p => p.id === room.hostId);
            if (host && host.ws && host.ws.readyState === 1) {
                host.ws.send(JSON.stringify({ type: 'guest_action', action: msg.action, playerId: cid }));
            }
        }
    });

    ws.on('close', () => {
        const cid = clientId.get(ws);
        const info = clientRoom.get(cid);
        if (info) {
            const room = rooms[info.code];
            if (room) {
                room.players = room.players.filter(p => p.id !== cid);
                cleanupRoom(info.code);
                broadcastPlayers(info.code);
            }
            clientRoom.delete(cid);
        }
        clientId.delete(ws);
    });
});

server.listen(PORT, () => {
    console.log(`Logic Arrows сервер запущено: http://localhost:${PORT}`);
    console.log(`WebSocket: ws://localhost:${PORT}`);
});
