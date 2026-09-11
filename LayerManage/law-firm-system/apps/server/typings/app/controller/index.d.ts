// This file is created by egg-ts-helper@1.35.2
// Do not modify this file!!!!!!!!!
/* eslint-disable */

import 'egg';
import ExportAdminGovernance from '../../../app/controller/adminGovernance';
import ExportAnomaly from '../../../app/controller/anomaly';
import ExportAppointment from '../../../app/controller/appointment';
import ExportAuth from '../../../app/controller/auth';
import ExportAuthorization from '../../../app/controller/authorization';
import ExportCase from '../../../app/controller/case';
import ExportChannel from '../../../app/controller/channel';
import ExportContract from '../../../app/controller/contract';
import ExportCost from '../../../app/controller/cost';
import ExportCustomer from '../../../app/controller/customer';
import ExportDashboard from '../../../app/controller/dashboard';
import ExportEmployee from '../../../app/controller/employee';
import ExportEmployeeAccountBinding from '../../../app/controller/employeeAccountBinding';
import ExportEmployeeAssignment from '../../../app/controller/employeeAssignment';
import ExportEmployeeReportingLine from '../../../app/controller/employeeReportingLine';
import ExportEventOperations from '../../../app/controller/eventOperations';
import ExportHome from '../../../app/controller/home';
import ExportInvoice from '../../../app/controller/invoice';
import ExportLead from '../../../app/controller/lead';
import ExportNegotiation from '../../../app/controller/negotiation';
import ExportNotification from '../../../app/controller/notification';
import ExportOrganization from '../../../app/controller/organization';
import ExportPayment from '../../../app/controller/payment';
import ExportPerformance from '../../../app/controller/performance';
import ExportPermission from '../../../app/controller/permission';
import ExportPosition from '../../../app/controller/position';
import ExportProfessionalTeam from '../../../app/controller/professionalTeam';
import ExportRefund from '../../../app/controller/refund';
import ExportRole from '../../../app/controller/role';
import ExportUser from '../../../app/controller/user';

declare module 'egg' {
  interface IController {
    adminGovernance: ExportAdminGovernance;
    anomaly: ExportAnomaly;
    appointment: ExportAppointment;
    auth: ExportAuth;
    authorization: ExportAuthorization;
    case: ExportCase;
    channel: ExportChannel;
    contract: ExportContract;
    cost: ExportCost;
    customer: ExportCustomer;
    dashboard: ExportDashboard;
    employee: ExportEmployee;
    employeeAccountBinding: ExportEmployeeAccountBinding;
    employeeAssignment: ExportEmployeeAssignment;
    employeeReportingLine: ExportEmployeeReportingLine;
    eventOperations: ExportEventOperations;
    home: ExportHome;
    invoice: ExportInvoice;
    lead: ExportLead;
    negotiation: ExportNegotiation;
    notification: ExportNotification;
    organization: ExportOrganization;
    payment: ExportPayment;
    performance: ExportPerformance;
    permission: ExportPermission;
    position: ExportPosition;
    professionalTeam: ExportProfessionalTeam;
    refund: ExportRefund;
    role: ExportRole;
    user: ExportUser;
  }
}
