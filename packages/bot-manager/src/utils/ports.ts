import { createServer } from "net";

export function getAvailablePort(preferred = 3001): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", (err) => reject(err));
    server.listen(preferred, () => {
      const address = server.address();
      if (typeof address === "object" && address?.port) {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error("Invalid server address")));
      }
    });
  });
}
