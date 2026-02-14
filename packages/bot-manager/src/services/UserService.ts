import { Repository } from "typeorm";
import { AppDataSource } from "@/datasource";
import { User, UserRole } from "@/entities/User";
import { BotAccess, BotPermission } from "@/entities/BotAccess";
import { Bot } from "@/entities/Bot";
import { createLogger } from "@/utils/logger";
import { TelegramAuthData } from "./AuthService";

const log = createLogger("UserService");

export class UserService {
  private userRepo: Repository<User>;
  private accessRepo: Repository<BotAccess>;
  private botRepo: Repository<Bot>;

  constructor() {
    this.userRepo = AppDataSource.getRepository(User);
    this.accessRepo = AppDataSource.getRepository(BotAccess);
    this.botRepo = AppDataSource.getRepository(Bot);
  }

  async init() {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
  }

  /**
   * Find or create user from Telegram auth data
   * First user automatically becomes admin
   */
  async findOrCreateUser(authData: TelegramAuthData): Promise<User> {
    await this.init();

    let user = await this.userRepo.findOne({
      where: { telegramId: authData.id },
    });

    if (user) {
      // Update user info
      user.username = authData.username;
      user.firstName = authData.first_name;
      user.lastName = authData.last_name;
      user.photoUrl = authData.photo_url;
      await this.userRepo.save(user);
      log.info(`User updated: userId=${user.id} telegramId=${authData.id}`);
      return user;
    }

    // Check if this is the first user
    const userCount = await this.userRepo.count();
    const isFirstUser = userCount === 0;

    user = this.userRepo.create({
      telegramId: authData.id,
      username: authData.username,
      firstName: authData.first_name,
      lastName: authData.last_name,
      photoUrl: authData.photo_url,
      role: isFirstUser ? "admin" : "viewer",
    });

    await this.userRepo.save(user);
    log.info(`User created: userId=${user.id} telegramId=${authData.id} role=${user.role} isFirstUser=${isFirstUser}`);

    return user;
  }

  /**
   * Get user by ID
   */
  async getUserById(userId: string): Promise<User | null> {
    await this.init();
    return this.userRepo.findOne({
      where: { id: userId },
      relations: ["botAccess"],
    });
  }

  /**
   * Get all users (admin only)
   */
  async getAllUsers(): Promise<User[]> {
    await this.init();
    return this.userRepo.find({
      order: { createdAt: "ASC" },
    });
  }

  /**
   * Update user role
   */
  async updateUserRole(userId: string, role: UserRole): Promise<User> {
    await this.init();
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new Error("User not found");
    }

    user.role = role;
    await this.userRepo.save(user);
    log.info(`User role updated: userId=${userId} role=${role}`);
    return user;
  }

  /**
   * Delete user
   */
  async deleteUser(userId: string): Promise<void> {
    await this.init();
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new Error("User not found");
    }

    await this.userRepo.remove(user);
    log.info(`User deleted: userId=${userId}`);
  }

  /**
   * Grant bot access to user
   */
  async grantBotAccess(
    userId: string,
    botId: string,
    permission: BotPermission
  ): Promise<BotAccess> {
    await this.init();

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new Error("User not found");
    }

    const bot = await this.botRepo.findOne({ where: { id: botId } });
    if (!bot) {
      throw new Error("Bot not found");
    }

    // Check if access already exists
    let access = await this.accessRepo.findOne({
      where: { user: { id: userId }, bot: { id: botId } },
    });

    if (access) {
      // Update existing access
      access.permission = permission;
      await this.accessRepo.save(access);
      log.info(`Bot access updated: userId=${userId} botId=${botId} permission=${permission}`);
    } else {
      // Create new access
      access = this.accessRepo.create({
        user,
        bot,
        permission,
      });
      await this.accessRepo.save(access);
      log.info(`Bot access granted: userId=${userId} botId=${botId} permission=${permission}`);
    }

    return access;
  }

  /**
   * Revoke bot access from user
   */
  async revokeBotAccess(userId: string, botId: string): Promise<void> {
    await this.init();

    const access = await this.accessRepo.findOne({
      where: { user: { id: userId }, bot: { id: botId } },
    });

    if (!access) {
      throw new Error("Access not found");
    }

    await this.accessRepo.remove(access);
    log.info(`Bot access revoked: userId=${userId} botId=${botId}`);
  }

  /**
   * Get user's access level for a bot
   */
  async getBotAccess(userId: string, botId: string): Promise<BotAccess | null> {
    await this.init();

    return this.accessRepo.findOne({
      where: { user: { id: userId }, bot: { id: botId } },
      relations: ["user", "bot"],
    });
  }

  /**
   * Get all bots accessible by user
   */
  async getUserBotsAccess(userId: string): Promise<BotAccess[]> {
    await this.init();

    return this.accessRepo.find({
      where: { user: { id: userId } },
      relations: ["bot"],
      order: { createdAt: "DESC" },
    });
  }

  /**
   * Get all users with access to a bot
   */
  async getBotUsers(botId: string): Promise<BotAccess[]> {
    await this.init();

    return this.accessRepo.find({
      where: { bot: { id: botId } },
      relations: ["user"],
      order: { createdAt: "ASC" },
    });
  }

  /**
   * Check if user can access bot (any permission level)
   */
  async canUserAccessBot(userId: string, botId: string, userRole: UserRole): Promise<boolean> {
    // Admins can access all bots
    if (userRole === "admin") {
      return true;
    }

    const access = await this.getBotAccess(userId, botId);
    return access !== null;
  }

  /**
   * Check if user can edit bot (editor or owner)
   */
  async canUserEditBot(userId: string, botId: string, userRole: UserRole): Promise<boolean> {
    // Admins can edit all bots
    if (userRole === "admin") {
      return true;
    }

    const access = await this.getBotAccess(userId, botId);
    if (!access) {
      return false;
    }

    return ["owner", "admin", "editor"].includes(access.permission);
  }

  /**
   * Check if user can manage access to bot (owner only or admin)
   */
  async canUserManageAccess(userId: string, botId: string, userRole: UserRole): Promise<boolean> {
    // Admins can manage all bots
    if (userRole === "admin") {
      return true;
    }

    const access = await this.getBotAccess(userId, botId);
    if (!access) {
      return false;
    }

    return access.permission === "owner";
  }

  /**
   * Check if any users exist
   */
  async hasUsers(): Promise<boolean> {
    await this.init();
    const count = await this.userRepo.count();
    return count > 0;
  }
}
