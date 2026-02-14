import { Request, Response, NextFunction } from "express";
import { AuthService } from "@/services/AuthService";
import { UserService } from "@/services/UserService";
import { User } from "@/entities/User";
import { createLogger } from "@/utils/logger";

const log = createLogger("AuthMiddleware");
const authService = new AuthService();
const userService = new UserService();

// Extend Express Request to include user
export interface AuthRequest extends Request {
  user?: User;
}

/**
 * Middleware to verify JWT token and attach user to request
 */
export async function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    const token = authService.extractToken(authHeader);

    if (!token) {
      res.status(401).json({ error: "No token provided" });
      return;
    }

    const payload = authService.verifyToken(token);
    if (!payload) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }

    // Load user from database
    const user = await userService.getUserById(payload.userId);
    if (!user) {
      res.status(401).json({ error: "User not found" });
      return;
    }

    // Attach user to request
    req.user = user;
    next();
  } catch (error) {
    log.error("Auth middleware error", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * Middleware factory to require specific roles
 * Usage: requireRole("admin"), requireRole("admin", "editor")
 */
export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        error: "Insufficient permissions",
        required: roles,
        current: req.user.role,
      });
      return;
    }

    next();
  };
}
