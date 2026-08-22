import net from "node:net";

/**
 * A clamd client, spoken directly rather than through a library.
 *
 * The INSTREAM protocol is about forty lines, and this is the component that
 * decides whether a file reaches an accountant. A dependency here would be one
 * more thing to audit, keep patched, and trust — for code shorter than its own
 * package.json.
 *
 * Protocol, from clamd(8):
 *
 *   > zINSTREAM\0
 *   > <uint32 big-endian length><chunk>   (repeated)
 *   > <uint32 zero>                       (end of stream)
 *   < stream: OK\0
 *   < stream: <SIGNATURE> FOUND\0
 *   < <message> ERROR\0
 *
 * The `z` prefix asks clamd to terminate its reply with NUL rather than a
 * newline, which is what makes the reply unambiguous to read.
 */

/** clamd's own limit is StreamMaxLength; 64KB chunks sit far inside any setting. */
const CHUNK_BYTES = 64 * 1024;

class ClamdError extends Error {}

function connect(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => resolve(socket));
    socket.once("timeout", () => {
      socket.destroy();
      reject(new ClamdError(`clamd did not answer within ${timeoutMs}ms`));
    });
    socket.once("error", (error) => reject(new ClamdError(`clamd unreachable: ${error.message}`)));
  });
}

/** Read until the NUL clamd sends to end a `z`-prefixed reply. */
function readReply(socket) {
  return new Promise((resolve, reject) => {
    const parts = [];
    socket.on("data", (chunk) => {
      parts.push(chunk);
      if (chunk.includes(0)) {
        resolve(Buffer.concat(parts).toString("utf8").replace(/\0+$/, "").trim());
        socket.end();
      }
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(new ClamdError("clamd stopped responding"));
    });
    socket.once("error", (error) => reject(new ClamdError(error.message)));
    socket.once("close", () => {
      // A close with no NUL is a truncated conversation, and a truncated
      // conversation must never be read as "nothing was found".
      if (parts.length === 0) reject(new ClamdError("clamd closed the connection without replying"));
      else resolve(Buffer.concat(parts).toString("utf8").replace(/\0+$/, "").trim());
    });
  });
}

/**
 * Scan a buffer.
 *
 * Returns `{ verdict: "clean" }` or `{ verdict: "blocked", threat }`. Anything
 * else — a protocol error, an unreachable daemon, a reply this does not
 * understand — **throws**. The caller turns a throw into a 503, never into a
 * clean verdict.
 */
export async function scanBuffer(bytes, { host, port, timeoutMs }) {
  const socket = await connect(host, port, timeoutMs);
  const reply = readReply(socket);

  socket.write("zINSTREAM\0");
  for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
    const chunk = bytes.subarray(offset, offset + CHUNK_BYTES);
    const header = Buffer.alloc(4);
    header.writeUInt32BE(chunk.length, 0);
    socket.write(header);
    socket.write(chunk);
  }
  socket.write(Buffer.alloc(4)); // a zero-length chunk ends the stream

  const text = await reply;

  if (/\bERROR\b/.test(text)) {
    throw new ClamdError(`clamd replied: ${text}`);
  }
  const found = text.match(/^stream:\s+(.+?)\s+FOUND$/);
  if (found) {
    return { verdict: "blocked", threat: found[1] };
  }
  if (/^stream:\s+OK$/.test(text)) {
    return { verdict: "clean" };
  }
  // An unrecognised reply is not a clean one.
  throw new ClamdError(`clamd replied something unrecognised: ${text.slice(0, 200)}`);
}

/**
 * The engine string reported back to One Book, so a blocked file names what
 * blocked it and which signatures were current when it did.
 */
export async function version({ host, port, timeoutMs }) {
  const socket = await connect(host, port, timeoutMs);
  const reply = readReply(socket);
  socket.write("zVERSION\0");
  return (await reply).slice(0, 100);
}

export async function ping({ host, port, timeoutMs }) {
  const socket = await connect(host, port, timeoutMs);
  const reply = readReply(socket);
  socket.write("zPING\0");
  return (await reply) === "PONG";
}
