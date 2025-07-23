import express from "express";
import { createServer } from "http";
import { createServer as createHttpsServer } from "https";
import { Server as SocketIOServer } from "socket.io";
import path from "path";
import { networkInterfaces } from "os";
import fs from "fs";

interface User {
  id: string;
  username: string;
  isSharing: boolean;
  shareType?: "screen" | "window" | "tab";
}

interface ShareSession {
  hostId: string;
  hostUsername: string;
  shareType: "screen" | "window" | "tab";
  viewers: Set<string>;
  startTime: Date;
}

const app = express();

// HTTPS用の証明書を確認・生成
function ensureSSLCertificates(): { key: Buffer; cert: Buffer } | null {
  const keyPath = path.join(__dirname, "../ssl/key.pem");
  const certPath = path.join(__dirname, "../ssl/cert.pem");

  try {
    if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
      return null;
    }

    const key = fs.readFileSync(keyPath);
    const cert = fs.readFileSync(certPath);

    if (key.length === 0 || cert.length === 0) {
      console.error("❌ SSL証明書ファイルが空です");
      return null;
    }

    return { key, cert };
  } catch (error) {
    console.error("❌ SSL証明書の読み込みに失敗しました:", error instanceof Error ? error.message : error);
    return null;
  }
}

// 静的ファイル配信
app.use(express.static(path.join(__dirname, "../public")));

// メインページ
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// ヘルスチェック用エンドポイント
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    connections: users.size,
    activeSessions: shareSessions.size,
  });
});

// ユーザー管理
const users = new Map<string, User>();
const shareSessions = new Map<string, ShareSession>();

// ローカルIPアドレス取得
function getLocalIPAddress(): string {
  const interfaces = networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const nets = interfaces[name];
    if (nets) {
      for (const net of nets) {
        if (net.family === "IPv4" && !net.internal) {
          return net.address;
        }
      }
    }
  }
  return "localhost";
}

// サーバー作成
const httpServer = createServer(app);
let httpsServer: any = null;
let sslCredentials: { key: Buffer; cert: Buffer } | null = null;

try {
  sslCredentials = ensureSSLCertificates();
  if (sslCredentials) {
    httpsServer = createHttpsServer(sslCredentials, app);
  }
} catch (error) {
  console.error("❌ HTTPSサーバーの作成に失敗しました:", error instanceof Error ? error.message : error);
  httpsServer = null;
}

// Socket.IO設定
const httpIO = new SocketIOServer(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

let httpsIO: any = null;
if (httpsServer) {
  try {
    httpsIO = new SocketIOServer(httpsServer, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"],
      },
    });
  } catch (error) {
    console.error("❌ HTTPS Socket.IOの初期化に失敗しました:", error instanceof Error ? error.message : error);
    httpsIO = null;
  }
}

// Socket.IO接続処理を関数化
function handleSocketConnection(socket: any, ioInstance: any) {
  // ユーザー名設定
  socket.on("set-username", (username: string) => {
    const user: User = {
      id: socket.id,
      username,
      isSharing: false,
    };
    users.set(socket.id, user);

    socket.emit("username-set", username);
    socket.emit("user-list", Array.from(users.values()));
    socket.emit(
      "active-shares",
      Array.from(shareSessions.values()).map((session) => ({
        hostId: session.hostId,
        hostUsername: session.hostUsername,
        shareType: session.shareType,
        viewerCount: session.viewers.size,
        startTime: session.startTime,
      }))
    );

    socket.broadcast.emit("user-joined", { username, userCount: users.size });
  });

  // 画面共有開始
  socket.on(
    "start-sharing",
    (data: { shareType: "screen" | "window" | "tab" }) => {
      const user = users.get(socket.id);
      if (!user) return;

      if (user.isSharing) {
        socket.emit("error", "すでに画面共有中です");
        return;
      }

      user.isSharing = true;
      user.shareType = data.shareType;

      const session: ShareSession = {
        hostId: socket.id,
        hostUsername: user.username,
        shareType: data.shareType,
        viewers: new Set(),
        startTime: new Date(),
      };

      shareSessions.set(socket.id, session);

      socket.emit("sharing-started");
      socket.broadcast.emit("share-available", {
        hostId: socket.id,
        hostUsername: user.username,
        shareType: data.shareType,
      });
    }
  );

  // 画面共有停止
  socket.on("stop-sharing", () => {
    const user = users.get(socket.id);
    const session = shareSessions.get(socket.id);

    if (user && session) {
      user.isSharing = false;
      user.shareType = undefined;

      session.viewers.forEach((viewerId) => {
        ioInstance.to(viewerId).emit("share-ended", { hostId: socket.id });
      });

      shareSessions.delete(socket.id);
      socket.broadcast.emit("share-unavailable", { hostId: socket.id });
      socket.emit("sharing-stopped");
    }
  });

  // 視聴参加
  socket.on("join-viewer", (hostId: string) => {
    const session = shareSessions.get(hostId);
    const viewer = users.get(socket.id);

    if (session && viewer) {
      session.viewers.add(socket.id);
      
      // 視聴者リストを作成
      const viewers = Array.from(session.viewers).map(viewerId => {
        const viewerUser = users.get(viewerId);
        return viewerUser ? { id: viewerId, username: viewerUser.username } : null;
      }).filter(Boolean);

      socket.emit("joined-as-viewer", {
        hostId,
        hostUsername: session.hostUsername,
      });
      
      // ホストに視聴者参加を通知（視聴者リスト付き）
      ioInstance.to(hostId).emit("viewer-joined", {
        viewerId: socket.id,
        viewerUsername: viewer.username,
        viewerCount: session.viewers.size,
        viewers: viewers,
      });

      // 全体に視聴者数更新を通知
      ioInstance.emit("viewers-updated", {
        hostId,
        viewerCount: session.viewers.size,
        viewers: viewers,
      });
    }
  });

  // 視聴離脱
  socket.on("leave-viewer", (hostId: string) => {
    const session = shareSessions.get(hostId);
    const viewer = users.get(socket.id);

    if (session && viewer) {
      session.viewers.delete(socket.id);
      
      // 視聴者リストを作成
      const viewers = Array.from(session.viewers).map(viewerId => {
        const viewerUser = users.get(viewerId);
        return viewerUser ? { id: viewerId, username: viewerUser.username } : null;
      }).filter(Boolean);

      socket.emit("left-viewer");
      
      // ホストに視聴者離脱を通知（視聴者リスト付き）
      ioInstance.to(hostId).emit("viewer-left", {
        viewerId: socket.id,
        viewerUsername: viewer.username,
        viewerCount: session.viewers.size,
        viewers: viewers,
      });

      // 全体に視聴者数更新を通知
      ioInstance.emit("viewers-updated", {
        hostId,
        viewerCount: session.viewers.size,
        viewers: viewers,
      });
    }
  });

  // WebRTC シグナリング
  socket.on(
    "offer",
    (data: { hostId: string; offer: RTCSessionDescriptionInit }) => {
      ioInstance
        .to(data.hostId)
        .emit("offer", { viewerId: socket.id, offer: data.offer });
    }
  );

  socket.on(
    "answer",
    (data: { viewerId: string; answer: RTCSessionDescriptionInit }) => {
      ioInstance
        .to(data.viewerId)
        .emit("answer", { hostId: socket.id, answer: data.answer });
    }
  );

  socket.on(
    "ice-candidate",
    (data: { targetId: string; candidate: RTCIceCandidateInit }) => {
      ioInstance.to(data.targetId).emit("ice-candidate", {
        fromId: socket.id,
        candidate: data.candidate,
      });
    }
  );

  // 切断処理
  socket.on("disconnect", () => {
    const user = users.get(socket.id);

    if (user) {
      if (user.isSharing) {
        const session = shareSessions.get(socket.id);
        if (session) {
          session.viewers.forEach((viewerId) => {
            ioInstance.to(viewerId).emit("share-ended", { hostId: socket.id });
          });
          shareSessions.delete(socket.id);
          socket.broadcast.emit("share-unavailable", { hostId: socket.id });
        }
      }

      shareSessions.forEach((session, hostId) => {
        if (session.viewers.has(socket.id)) {
          session.viewers.delete(socket.id);
          
          // 視聴者リストを作成
          const viewers = Array.from(session.viewers).map(viewerId => {
            const viewerUser = users.get(viewerId);
            return viewerUser ? { id: viewerId, username: viewerUser.username } : null;
          }).filter(Boolean);

          ioInstance.to(hostId).emit("viewer-left", {
            viewerId: socket.id,
            viewerUsername: user.username,
            viewerCount: session.viewers.size,
            viewers: viewers,
          });

          // 全体に視聴者数更新を通知
          ioInstance.emit("viewers-updated", {
            hostId,
            viewerCount: session.viewers.size,
            viewers: viewers,
          });
        }
      });

      users.delete(socket.id);
      socket.broadcast.emit("user-left", {
        username: user.username,
        userCount: users.size,
      });
    }
  });
}

// HTTP Socket.IO接続
httpIO.on("connection", (socket) => {
  handleSocketConnection(socket, httpIO);
});

// HTTPS Socket.IO接続
if (httpsIO) {
  httpsIO.on("connection", (socket: any) => {
    handleSocketConnection(socket, httpsIO);
  });
}

const PORT = parseInt(process.env.PORT || "3000", 10);
const HTTP_PORT = PORT + 1; // HTTPポートは3001
const localIP = getLocalIPAddress();

// HTTPSサーバーを起動（SSL証明書がある場合）
if (httpsServer) {
  httpsServer.listen(PORT, "0.0.0.0", () => {
    console.debug(`🔒 HTTPSサーバー起動: https://localhost:${PORT} | https://${localIP}:${PORT}`);
  });

  httpsServer.on("error", (error: any) => {
    console.error("❌ HTTPSサーバーでエラーが発生しました:", error);
    if (error.code === "EADDRINUSE") {
      console.error(`ポート ${PORT} は既に使用されています`);
    } else if (error.code === "EACCES") {
      console.error(
        `ポート ${PORT} へのアクセスが拒否されました（管理者権限が必要かもしれません）`
      );
    }
  });
} else {
  console.debug("⚠️  HTTPSサーバーを起動できませんでした。SSL証明書を生成してください: npm run generate-ssl");
}

// HTTPサーバーを起動
httpServer.listen(HTTP_PORT, "0.0.0.0", () => {
  console.debug(`🌐 HTTPサーバー起動: http://localhost:${HTTP_PORT} | http://${localIP}:${HTTP_PORT}`);
  if (!httpsServer) {
    console.debug("💡 画面共有機能を使用するには、 'npm run generate-ssl' でSSL証明書を生成し、HTTPSで接続してください。");
  }
});

httpServer.on("error", (error: any) => {
  console.error("❌ HTTPサーバーでエラーが発生しました:", error);

  if (error.code === "EADDRINUSE") {
    console.error(`ポート ${HTTP_PORT} は既に使用されています`);
  }
});
