// This file is created by egg-ts-helper@1.35.2
// Do not modify this file!!!!!!!!!
/* eslint-disable */

import 'egg';
import ExportApproval from '../../../app/controller/approval';
import ExportAuth from '../../../app/controller/auth';
import ExportCase from '../../../app/controller/case';
import ExportChannel from '../../../app/controller/channel';
import ExportContract from '../../../app/controller/contract';
import ExportCustomer from '../../../app/controller/customer';
import ExportDashboard from '../../../app/controller/dashboard';
import ExportEmployee from '../../../app/controller/employee';
import ExportHome from '../../../app/controller/home';
import ExportLead from '../../../app/controller/lead';
import ExportNotification from '../../../app/controller/notification';
import ExportOrganization from '../../../app/controller/organization';
import ExportPayment from '../../../app/controller/payment';
import ExportPerformance from '../../../app/controller/performance';
import ExportPermission from '../../../app/controller/permission';
import ExportPosition from '../../../app/controller/position';
import ExportRole from '../../../app/controller/role';
import ExportUser from '../../../app/controller/user';

declare module 'egg' {
  interface IController {
    approval: ExportApproval;
    auth: ExportAuth;
    case: ExportCase;
    channel: ExportChannel;
    contract: ExportContract;
    customer: ExportCustomer;
    dashboard: ExportDashboard;
    employee: ExportEmployee;
    home: ExportHome;
    lead: ExportLead;
    notification: ExportNotification;
    organization: ExportOrganization;
    payment: ExportPayment;
    performance: ExportPerformance;
    permission: ExportPermission;
    position: ExportPosition;
    role: ExportRole;
    user: ExportUser;
  }
}
