import net from "node:net";

/**
 * A clamd that speaks the real protocol and finds one real signature.
 *
 * Written to clamd(8) rather than to `clamd.mjs`, deliberately: a stub shaped
 * like the client it tests proves only that the client agrees with itself. This
 * reassembles the length-prefixed chunks the way the daemon does, and answers in
 * the daemon's own wording.
 *
 * It detects EICAR — the industry-standard harmless test string that every
 * scanner is required to flag — so the blocked path is exercised with the same
 * input a real deployment can be checked with.
 */

export const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

export function startFakeClamd({ behaviour = "normal" } = {}) {
  const server = net.createServer((socket) => {
    let buffer = Buffer.alloc(0);
    let command = null;
    const chunks = [];
    let streaming = false;

    socket.on("data", (data) => {
      buffer = Buffer.concat([buffer, data]);

      if (!command) {
        const nul = buffer.indexOf(0);
        if (nul === -1) return;
        command = buffer.subarray(0, nul).toString("utf8");
        buffer = buffer.subarray(nul + 1);

        if (command === "zPING") return socket.end("PONG\0");
        if (command === "zVERSION") {
          return socket.end("ClamAV 1.0.5/27412/Fri Aug 22 08:00:00 2026\0");
        }
        if (command !== "zINSTREAM") return socket.end("UNKNOWN COMMAND ERROR\0");
        streaming = true;
      }

      if (!streaming) return;

      // Reassemble <uint32 length><chunk> until the zero-length terminator.
      for (;;) {
        if (buffer.length < 4) return;
        const length = buffer.readUInt32BE(0);
        if (length === 0) {
          buffer = buffer.subarray(4);
          const body = Buffer.concat(chunks).toString("latin1");
          if (behaviour === "daemon-error") return socket.end("Database not loaded ERROR\0");
          if (behaviour === "truncated") return socket.destroy();
          if (behaviour === "gibberish") return socket.end("who knows\0");
          if (body.includes(EICAR)) {
            return socket.end("stream: Eicar-Signature FOUND\0");
          }
          return socket.end("stream: OK\0");
        }
        if (buffer.length < 4 + length) return;
        chunks.push(buffer.subarray(4, 4 + length));
        buffer = buffer.subarray(4 + length);
      }
    });

    socket.on("error", () => socket.destroy());
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}
