const http = require('http');
const url = require('url');

const PORT = process.env.PORT || 8000;

let peers = {};

function parseQuery(q) {
  const params = {};
  for (const [key, val] of new URLSearchParams(q)) {
    params[key] = val;
  }
  return params;
}

function bencode(data) {
  if (typeof data === 'number') return 'i' + data + 'e';
  if (typeof data === 'string') return data.length + ':' + data;
  if (Buffer.isBuffer(data)) return data.length + ':' + data.toString('binary');
  if (Array.isArray(data)) return 'l' + data.map(bencode).join('') + 'e';
  if (typeof data === 'object') {
    let res = 'd';
    Object.keys(data).sort().forEach(k => {
      res += bencode(k) + bencode(data[k]);
    });
    res += 'e';
    return res;
  }
  return '';
}

function compactPeers(peersList) {
  const buf = Buffer.alloc(peersList.length * 6);
  peersList.forEach((p, i) => {
    const ipParts = p.ip.split('.').map(x => parseInt(x));
    buf.writeUInt8(ipParts[0], i * 6);
    buf.writeUInt8(ipParts[1], i * 6 + 1);
    buf.writeUInt8(ipParts[2], i * 6 + 2);
    buf.writeUInt8(ipParts[3], i * 6 + 3);
    buf.writeUInt16BE(p.port, i * 6 + 4);
  });
  return buf;
}

const server = http.createServer((req, res) => {
  const reqUrl = url.parse(req.url);
  if (reqUrl.pathname !== '/announce') {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  const params = parseQuery(reqUrl.query);
  const info_hash = params['info_hash'];
  const peer_id = params['peer_id'];
  const port = parseInt(params['port']);
  const uploaded = parseInt(params['uploaded'] || '0');
  const downloaded = parseInt(params['downloaded'] || '0');
  const left = parseInt(params['left'] || '0');
  const event = params['event'] || '';

  if (!info_hash || !peer_id || !port) {
    res.writeHead(400);
    res.end('Missing parameters');
    return;
  }

  if (!peers[info_hash]) peers[info_hash] = [];

  // Get IP from request headers or socket
  let ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || '';
  if (ip.startsWith('::ffff:')) ip = ip.substr(7);
  if (ip.includes(':')) ip = ip.split(':').pop();

  // Remove peer if exists
  peers[info_hash] = peers[info_hash].filter(p => p.peer_id !== peer_id);

  if (event !== 'stopped') {
    peers[info_hash].push({ peer_id, ip, port, left, uploaded, downloaded, lastSeen: Date.now() });
  }

  // Clean peers older than 30 minutes
  const now = Date.now();
  peers[info_hash] = peers[info_hash].filter(p => now - p.lastSeen < 30 * 60 * 1000);

  const peerList = peers[info_hash]
    .filter(p => p.peer_id !== peer_id && p.left > 0)
    .slice(0, 50)
    .map(p => ({ ip: p.ip, port: p.port }));

  const response = {
    'interval': 1800,
    'peers': compactPeers(peerList)
  };

  const bencoded = bencode(response);
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(bencoded, 'binary');
});

server.listen(PORT, () => {
  console.log(`Tracker running on port ${PORT}`);
});
