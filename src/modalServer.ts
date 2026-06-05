import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";

export class ModalServer {
  private server: Server | null = null;
  private port: number | null = null;
  private readonly pages = new Map<string, string>();

  async addPage(html: string): Promise<string> {
    await this.start();
    const id = randomBytes(16).toString("hex");
    this.pages.set(id, html);
    return `http://127.0.0.1:${this.port}/${id}`;
  }

  close() {
    this.server?.close();
    this.server = null;
    this.port = null;
    this.pages.clear();
  }

  private async start() {
    if (this.server) return;

    const server = createServer((request, response) => {
      const id = request.url?.slice(1).split("?")[0] ?? "";
      const html = this.pages.get(id);
      if (!html) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("InLive modal page not found.");
        return;
      }

      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(html);
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    const address = server.address();
    if (typeof address !== "object" || !address) {
      server.close();
      throw new Error("Modal server did not expose a port.");
    }

    this.server = server;
    this.port = address.port;
  }
}
