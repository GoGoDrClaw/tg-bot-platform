import crypto from "crypto";
import jwt from "jsonwebtoken";
import { createLogger } from "@/utils/logger";

const log = createLogger("AuthService");

export interface TelegramAuthData {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

export interface JWTPayload {
  userId: string;
  telegramId: number;
  role: string;
  iat: number;
  exp: number;
}

export class AuthService {
  private jwtSecret: string;
  private botToken: string;

  constructor() {
    this.jwtSecret = process.env.JWT_SECRET || "change-me-in-production";
    this.botToken = process.env.TELEGRAM_WIDGET_BOT_TOKEN || "";

    if (this.jwtSecret === "change-me-in-production") {
      log.warn("⚠️  Using default JWT_SECRET. Set JWT_SECRET in .env for production!");
    }

    if (!this.botToken) {
      log.warn("⚠️  TELEGRAM_WIDGET_BOT_TOKEN not set. Telegram auth will fail!");
    }
  }

  /**
   * Validates Telegram Login Widget auth data
   * https://core.telegram.org/widgets/login#checking-authorization
   */
  validateTelegramAuth(authData: TelegramAuthData): boolean {
    const { hash, ...dataCheckFields } = authData;

    // Check auth_date is not too old (24 hours)
    const authAge = Date.now() / 1000 - authData.auth_date;
    if (authAge > 86400) {
      log.warn(`Telegram auth data too old: ${authAge}s`);
      return false;
    }

    // Create data-check-string
    const checkArr = Object.keys(dataCheckFields)
      .sort()
      .map((key) => `${key}=${(dataCheckFields as any)[key]}`);
    const dataCheckString = checkArr.join("\n");

    // Calculate secret key from bot token
    const secretKey = crypto.createHash("sha256").update(this.botToken).digest();

    // Calculate hash
    const calculatedHash = crypto
      .createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    const isValid = calculatedHash === hash;

    if (!isValid) {
      log.warn(`Telegram auth hash validation failed: received=${hash.substring(0, 10)}... calculated=${calculatedHash.substring(0, 10)}...`);
    }

    return isValid;
  }

  /**
   * Generates JWT token for authenticated user
   */
  generateToken(userId: string, telegramId: number, role: string): string {
    const payload: Omit<JWTPayload, "iat" | "exp"> = {
      userId,
      telegramId,
      role,
    };

    const token = jwt.sign(payload, this.jwtSecret, {
      expiresIn: "7d", // 7 days
    });

    log.info(`JWT token generated for userId=${userId} telegramId=${telegramId} role=${role}`);
    return token;
  }

  /**
   * Verifies and decodes JWT token
   */
  verifyToken(token: string): JWTPayload | null {
    try {
      const decoded = jwt.verify(token, this.jwtSecret) as JWTPayload;
      return decoded;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        log.warn("JWT token expired");
      } else if (error instanceof jwt.JsonWebTokenError) {
        log.warn(`Invalid JWT token: ${error.message}`);
      } else {
        log.error("JWT verification error", error);
      }
      return null;
    }
  }

  /**
   * Extracts JWT token from Authorization header
   * Expected format: "Bearer <token>"
   */
  extractToken(authHeader: string | undefined): string | null {
    if (!authHeader) {
      return null;
    }

    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer") {
      log.warn(`Invalid Authorization header format: ${authHeader.substring(0, 20)}...`);
      return null;
    }

    return parts[1];
  }
}
