import "reflect-metadata";
import "./aliasBootstrap";
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import path from "path";
import { BotService } from "@/services/BotService";
import { AuthService } from "@/services/AuthService";
import { UserService } from "@/services/UserService";
import { authMiddleware, requireRole, AuthRequest } from "@/middleware/auth";
import { rateLimit } from "@/middleware/rateLimit";
import { createLogger } from "@/utils/logger";

const log = createLogger("server");

const app = express();
const botService = new BotService();
const authService = new AuthService();
const userService = new UserService();

app.use(cors());
app.use(bodyParser.json({ limit: "10mb" }));

app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - start;
    log.info(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`);
  });
  next();
});

app.get("/health", (_req, res) => res.json({ ok: true }));

// ============================================================================
// AUTH ENDPOINTS
// ============================================================================

/**
 * Check if any users exist (for welcome screen)
 */
app.get("/auth/check", async (_req, res) => {
  try {
    const hasUsers = await userService.hasUsers();
    res.json({ hasUsers });
  } catch (err: any) {
    log.error("auth check error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Telegram Login callback
 * Rate limited to prevent brute force
 */
app.post("/auth/telegram", rateLimit(10, 60000), async (req, res) => {
  try {
    const authData = req.body;

    // Validate Telegram auth data
    const isValid = authService.validateTelegramAuth(authData);
    if (!isValid) {
      return res.status(401).json({ error: "Invalid Telegram authentication" });
    }

    // Find or create user
    const user = await userService.findOrCreateUser(authData);

    // Generate JWT token
    const token = authService.generateToken(user.id, user.telegramId, user.role);

    res.json({
      token,
      user: {
        id: user.id,
        telegramId: user.telegramId,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        photoUrl: user.photoUrl,
        role: user.role,
      },
    });
  } catch (err: any) {
    log.error("telegram auth error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Get current user (protected)
 */
app.get("/me", authMiddleware, async (req: AuthRequest, res) => {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  res.json({
    id: req.user.id,
    telegramId: req.user.telegramId,
    username: req.user.username,
    firstName: req.user.firstName,
    lastName: req.user.lastName,
    photoUrl: req.user.photoUrl,
    role: req.user.role,
  });
});

// ============================================================================
// USER MANAGEMENT ENDPOINTS (Admin only)
// ============================================================================

/**
 * Get all users (admin only)
 */
app.get("/users", authMiddleware, requireRole("admin"), async (_req, res) => {
  try {
    const users = await userService.getAllUsers();
    res.json(
      users.map((u) => ({
        id: u.id,
        telegramId: u.telegramId,
        username: u.username,
        firstName: u.firstName,
        lastName: u.lastName,
        photoUrl: u.photoUrl,
        role: u.role,
        createdAt: u.createdAt,
      }))
    );
  } catch (err: any) {
    log.error("get users error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Update user role (admin only)
 */
app.patch("/users/:userId/role", authMiddleware, requireRole("admin"), async (req, res) => {
  try {
    const { userId } = req.params;
    const { role } = req.body;

    if (!role || !["admin", "editor", "viewer"].includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }

    const user = await userService.updateUserRole(userId, role);
    res.json({ id: user.id, role: user.role });
  } catch (err: any) {
    log.error("update user role error", err);
    res.status(400).json({ error: err.message });
  }
});

/**
 * Delete user (admin only)
 */
app.delete("/users/:userId", authMiddleware, requireRole("admin"), async (req, res) => {
  try {
    await userService.deleteUser(req.params.userId);
    res.status(204).end();
  } catch (err: any) {
    log.error("delete user error", err);
    res.status(400).json({ error: err.message });
  }
});

// ============================================================================
// BOT ENDPOINTS (Protected)
// ============================================================================

app.post("/bots", authMiddleware, async (req: AuthRequest, res) => {
  const stream = String(req.query.stream ?? "") === "true";
  if (stream) {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Transfer-Encoding", "chunked");
  }
  try {
    const bot = await botService.createBot(
      req.body,
      req.user?.id, // Pass userId for owner access
      stream
        ? (chunk) => {
            const withBreak = chunk.endsWith("\n") ? chunk : `${chunk}\n`;
            res.write(withBreak);
          }
        : undefined
    );
    if (stream) {
      res.write(`\n--- BOT CREATED ---\n${JSON.stringify(bot, null, 2)}\n`);
      res.end();
    } else {
      res.status(201).json(bot);
    }
  } catch (err: any) {
    if (stream) {
      res.write(`\nERROR: ${err.message}\n`);
      res.end();
    } else {
      res.status(400).json({ error: err.message });
    }
  }
});

app.get("/bots", authMiddleware, async (req: AuthRequest, res) => {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const bots = await botService.getUserBots(req.user.id, req.user.role);
  res.json(bots);
});

app.get("/bots/:id", authMiddleware, async (req, res) => {
  const bot = await botService.getBot(req.params.id);
  if (!bot) {
    return res.status(404).json({ error: "Not found" });
  }
  res.json(bot);
});

app.post("/bots/:id/start", authMiddleware, async (req, res) => {
  try {
    const bot = await botService.startBot(req.params.id);
    res.json(bot);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/bots/:id/stop", authMiddleware, async (req, res) => {
  try {
    await botService.stopBot(req.params.id);
    res.status(204).end();
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/bots/:id/restart", authMiddleware, async (req, res) => {
  try {
    await botService.restartBot(req.params.id);
    res.status(204).end();
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/bots/:id/upgrade-runtime", authMiddleware, async (req, res) => {
  try {
    const bot = await botService.upgradeRuntime(req.params.id);
    res.json(bot);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/bots/:id/webhook/setup", authMiddleware, async (req, res) => {
  try {
    const result = await botService.setupWebhook(req.params.id);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/bots/:id/webhook", authMiddleware, async (req, res) => {
  try {
    const info = await botService.getWebhook(req.params.id);
    res.json(info);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/bots/:id/webhook/delete", authMiddleware, async (req, res) => {
  try {
    await botService.deleteWebhooks(req.params.id);
    res.status(204).end();
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/bots/:id/git/status", authMiddleware, async (req, res) => {
  try {
    const status = await botService.gitStatus(req.params.id);
    res.json(status);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/bots/:id/git/upgrade", authMiddleware, async (req, res) => {
  try {
    const bot = await botService.gitUpgrade(req.params.id);
    res.json(bot);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/bots/:id/logs", authMiddleware, async (req, res) => {
  try {
    const tail = Number(req.query.tail ?? 100);
    const logs = await botService.getLogs(req.params.id, tail);
    res.type("text/plain").send(logs);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/bots/:id/env", authMiddleware, async (req, res) => {
  try {
    const bot = await botService.updateEnv(req.params.id, req.body?.env ?? {});
    res.json(bot);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================================================
// BOT ACCESS MANAGEMENT ENDPOINTS
// ============================================================================

/**
 * Get users with access to a bot
 */
app.get("/bots/:id/access", authMiddleware, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const botId = req.params.id;

    // Check if user can manage access (owner or admin)
    const canManage = await userService.canUserManageAccess(botId, req.user.id, req.user.role);
    if (!canManage) {
      return res.status(403).json({ error: "Only bot owners and admins can view access" });
    }

    const accessList = await userService.getBotUsers(botId);
    res.json(
      accessList.map((access) => ({
        userId: access.user.id,
        telegramId: access.user.telegramId,
        username: access.user.username,
        firstName: access.user.firstName,
        lastName: access.user.lastName,
        permission: access.permission,
        createdAt: access.createdAt,
      }))
    );
  } catch (err: any) {
    log.error("get bot access error", err);
    res.status(400).json({ error: err.message });
  }
});

/**
 * Grant access to a bot
 */
app.post("/bots/:id/access", authMiddleware, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const botId = req.params.id;
    const { userId, permission } = req.body;

    if (!userId || !permission) {
      return res.status(400).json({ error: "userId and permission are required" });
    }

    if (!["owner", "admin", "editor", "viewer"].includes(permission)) {
      return res.status(400).json({ error: "Invalid permission" });
    }

    // Check if user can manage access (owner or admin)
    const canManage = await userService.canUserManageAccess(botId, req.user.id, req.user.role);
    if (!canManage) {
      return res.status(403).json({ error: "Only bot owners and admins can grant access" });
    }

    const access = await userService.grantBotAccess(userId, botId, permission);
    res.status(201).json({
      userId: access.user.id,
      botId: access.bot.id,
      permission: access.permission,
    });
  } catch (err: any) {
    log.error("grant bot access error", err);
    res.status(400).json({ error: err.message });
  }
});

/**
 * Revoke access to a bot
 */
app.delete("/bots/:id/access/:userId", authMiddleware, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const botId = req.params.id;
    const userId = req.params.userId;

    // Check if user can manage access (owner or admin)
    const canManage = await userService.canUserManageAccess(botId, req.user.id, req.user.role);
    if (!canManage) {
      return res.status(403).json({ error: "Only bot owners and admins can revoke access" });
    }

    await userService.revokeBotAccess(userId, botId);
    res.status(204).end();
  } catch (err: any) {
    log.error("revoke bot access error", err);
    res.status(400).json({ error: err.message });
  }
});

app.delete("/bots/:id", authMiddleware, async (req, res) => {
  try {
    await botService.removeBot(req.params.id);
    res.status(204).end();
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================================================
// PUBLIC WEBHOOK ENDPOINT (No auth required)
// ============================================================================

app.post("/w/:id", async (req, res) => {
  try {
    await botService.forwardWebhook(req.params.id, req.body);
    res.sendStatus(200);
  } catch (err: any) {
    log.error("webhook forward failed", err);
    res.sendStatus(200); // respond 200 to avoid Telegram retries storm
  }
});

const webRoot = path.resolve(__dirname, "../../web-ui");
app.use(express.static(webRoot));

const port = Number(process.env.API_PORT ?? 3000);
const host = process.env.API_HOST ?? "127.0.0.1";
app.listen(port, host, () => {
  log.info(`Bot Manager API running on http://${host}:${port}`);
});
