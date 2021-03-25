import request from "request";
import URLParse from "url-parse";

export interface DownloadFileOptions {
  url: string | URLParse;
  gzip?: boolean;
  timeout?: number;
}

export interface DownloadFileTicket {
  url: string;
  promise: Promise<Buffer>;
  cancel(): void;
}

export function downloadFile({ url, timeout, gzip = true }: DownloadFileOptions): DownloadFileTicket {
  url = url.toString();

  const fileChunks: Buffer[] = [];
  const req = request(url, { gzip, timeout });
  const promise: Promise<Buffer> = new Promise((resolve, reject) => {
    req.on("data", (chunk: Buffer) => {
      fileChunks.push(chunk);
    });
    req.once("error", err => {
      reject({ url, err });
    });
    req.once("complete", () => {
      resolve(Buffer.concat(fileChunks));
    });
  });

  return {
    url,
    promise,
    cancel() {
      req.abort();
    }
  };
}
