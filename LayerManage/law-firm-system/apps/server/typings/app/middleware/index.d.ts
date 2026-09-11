// This file is created by egg-ts-helper@1.35.2
// Do not modify this file!!!!!!!!!
/* eslint-disable */

import 'egg';
import ExportAdministratorMfaGuard from '../../../app/middleware/administratorMfaGuard';
import ExportAuth from '../../../app/middleware/auth';
import ExportAuthorizationContext from '../../../app/middleware/authorizationContext';
import ExportCsrf from '../../../app/middleware/csrf';
import ExportErrorHandler from '../../../app/middleware/errorHandler';
import ExportRequirePermission from '../../../app/middleware/requirePermission';

declare module 'egg' {
  interface IMiddleware {
    administratorMfaGuard: typeof ExportAdministratorMfaGuard;
    auth: typeof ExportAuth;
    authorizationContext: typeof ExportAuthorizationContext;
    csrf: typeof ExportCsrf;
    errorHandler: typeof ExportErrorHandler;
    requirePermission: typeof ExportRequirePermission;
  }
}
