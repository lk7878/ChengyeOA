import { IHelper } from 'egg';

export default {
  /**
   * 统一成功响应
   */
  success(this: IHelper, data: any = null, message: string = 'success') {
    return {
      code: 200,
      message,
      data,
      timestamp: Date.now(),
    };
  },

  /**
   * 统一错误响应
   */
  error(this: IHelper, message: string = 'error', code: number = 500, errors: any = null) {
    return {
      code,
      message,
      errors,
      timestamp: Date.now(),
    };
  },

  /**
   * 分页响应
   */
  pagination(this: IHelper, list: any[], page: number, pageSize: number, total: number) {
    return {
      code: 200,
      message: 'success',
      data: {
        list,
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
      },
      timestamp: Date.now(),
    };
  },

  /**
   * 密码加密
   */
  hashPassword(this: IHelper, password: string): string {
    const bcrypt = require('bcryptjs');
    const salt = bcrypt.genSaltSync(10);
    return bcrypt.hashSync(password, salt);
  },

  /**
   * 验证密码
   */
  comparePassword(this: IHelper, password: string, hash: string): boolean {
    const bcrypt = require('bcryptjs');
    return bcrypt.compareSync(password, hash);
  },

  /**
   * 生成 UUID
   */
  generateUUID(this: IHelper): string {
    return require('crypto').randomUUID();
  },

  /**
   * 手机号脱敏
   */
  maskPhone(this: IHelper, phone: string): string {
    if (!phone || phone.length !== 11) return phone;
    return phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
  },

  /**
   * 身份证号脱敏
   */
  maskIdCard(this: IHelper, idCard: string): string {
    if (!idCard || idCard.length !== 18) return idCard;
    return idCard.replace(/(\d{6})\d{8}(\d{4})/, '$1********$2');
  },
};
