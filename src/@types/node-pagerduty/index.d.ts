declare module "node-pagerduty" {
    interface IAbilitiesApi {
        listAbilities(): Promise<any>;

        testAbility(id: string): Promise<any>;
    }

    interface IAddonsApi {
        listAddons(qs: string): Promise<any>;

        installAddOn(payload: string): Promise<any>;

        deleteAddon(id: string): Promise<any>;

        getAddon(id: string): Promise<any>;

        updateAddon(id: string, payload: any): Promise<any>;
    }

    interface IContextualSearchApi {
        listTags(qs: string): Promise<any>;

        createTag(payload: any): Promise<any>;

        deleteTag(id: string): Promise<any>;

        getTag(id: string): Promise<any>;

        getConnectedEntities(id: string, entityType: any): Promise<any>;

        assignTags(entityType: string, id: string, payload: any): Promise<any>;
    }

    interface IEscalationPoliciesApi {
        listEscalationPolicies(qs: string): Promise<any>;

        createEscalationPolicy(from: string, payload: any): Promise<any>;

        deleteEscalationPolicy(id: string): Promise<any>;

        getEscalationPolicy(id: string, qs: string): Promise<any>;

        updateEscalationPolicy(id: string, payload: any): Promise<any>;
    }

// Event Rules
// https://v2.developer.pagerduty.com/docs/global-event-rules-api
    interface IEventRulesApi {
        listEventRules(): Promise<any>;

        createEventRule(payload: any): Promise<any>;

        updateEventRule(id: string, payload: any): Promise<any>;

        deleteEventRule(id: string): Promise<any>;
    }

// Extension Schemas
// https://v2.developer.pagerduty.com/v2/page/api-reference#!/Extension_Schemas
    interface IExtensionSchemasApi {
        listExtensionSchemas(): Promise<any>;

        getExtensionVendor(id: string): Promise<any>;
    }

// Extensions
// https://v2.developer.pagerduty.com/v2/page/api-reference#!/Extensions
    interface IExtensionsApi {
        listExtensions(qs: string): Promise<any>;

        createExtension(payload: any): Promise<any>;

        deleteExtension(id: string): Promise<any>;

        getExtension(id: string, qs: string): Promise<any>;

        updateExtension(id: string, payload: any): Promise<any>;
    }

// Events
// https://v2.developer.pagerduty.com/docs/send-an-event-events-api-v2
    interface IEventsApi {
        sendEvent(payload: any): Promise<any>;
    }

// IncidentsApi// https://v2.developer.pagerduty.com/v2/page/api-reference#!/IncidentsApi
    interface IIncidentsApi {
        listIncidents(qs: string): Promise<any>;

        createIncident(from: string, payload: any): Promise<any>;

        manageIncident(from: string, payload: any): Promise<any>;

        mergeIncidents(id: string, from: string, payload: any): Promise<any>;

        getIncident(id: string): Promise<any>;

        updateIncident(id: string, from: string, payload: any): Promise<any>;

        listAlerts(id: string, qs: string): Promise<any>;

        manageAlerts(id: string, from: string, payload: any): Promise<any>;

        getAlert(id: string, alertid: string): Promise<any>;

        updateAlert(id: string, alertid: string, from: string, payload: any): Promise<any>;

        listLogEntries(id: string, qs: string): Promise<any>;

        listNotes(id: string): Promise<any>;

        createNote(id: string, from: string, payload: any): Promise<any>;

        createStatusUpdate(id: string, from: string, payload: any): Promise<any>;

        createResponderRequest(id: string, from: string, payload: any): Promise<any>;

        snoozeIncident(id: string, from: string, payload: any): Promise<any>;
    }

// Priorities
// https://v2.developer.pagerduty.com/v2/page/api-reference#!/Priorities
    interface IPrioritiesApi {
        listPriorities(): Promise<any>;
    }

// Response Plays
// https://v2.developer.pagerduty.com/v2/page/api-reference#!/Response_Plays
    interface IResponsePlaysApi {
        runResponsePlay(id: string, from: string, payload: any): Promise<any>
    }

// Log Entries
// https://v2.developer.pagerduty.com/v2/page/api-reference#!/Log_Entries
    interface ILogEntriesApi {
        listLogEntries(qs: string): Promise<any>;

        getLogEntry(id: string, qs: string): Promise<any>;
    }

// Maintenance Windows
// https://v2.developer.pagerduty.com/v2/page/api-reference#!/Maintenance_Windows
    interface IMaintenanceWindowsApi {
        listMaintenanceWindows(qs: string): Promise<any>;

        createMaintenanceWindow(from: string, payload: any): Promise<any>;

        deleteMaintenanceWindow(id: string): Promise<any>;

        getMaintenanceWindow(id: string, qs: string): Promise<any>;

        updateMaintenanceWindow(id: string, payload: any): Promise<any>;
    }

// Notifications
// https://v2.developer.pagerduty.com/v2/page/api-reference#!/Notifications
    interface INotificationsApi {
        listNotifications(qs: string): Promise<any>;
    }

// On-Calls
// https://v2.developer.pagerduty.com/v2/page/api-reference#!/On-Calls
    interface IOnCallsApi {
        listAllOnCalls(qs: string): Promise<any>;
    }

// Schedules
// https://v2.developer.pagerduty.com/v2/page/api-reference#!/Schedules
    interface ISchedulesApi {
        listSchedule(qs: string): Promise<any>;

        createSchedule(qs: string, payload: any): Promise<any>;

        previewSchedule(qs: string, payload: any): Promise<any>;

        deleteSchedule(id: string): Promise<any>;

        getSchedule(id: string, qs: string): Promise<any>;

        updateSchedule(id: string, qs: string, payload: any): Promise<any>;

        listOverrides(id: string, qs: string): Promise<any>;

        createOverride(id: string, payload: any): Promise<any>;

        deleteOverride(id: string, overrideid: string): Promise<any>;

        listUsersOnCall(id: string, qs: string): Promise<any>;
    }

// Services
// https://v2.developer.pagerduty.com/v2/page/api-reference#!/Services
    interface IServicesApi {
        listServices(qs: string): Promise<any>;

        createService(payload: any): Promise<any>;

        deleteService(id: string): Promise<any>;

        getService(id: string, qs: string): Promise<any>;

        updateService(id: string, payload: any): Promise<any>;

        createIntegration(id: string, payload: any): Promise<any>;

        viewIntegration(id: string, integrationid: string): Promise<any>;

        updateIntegration(id: string, integrationid: string, payload: any): Promise<any>;
    }

// Teams
// https://v2.developer.pagerduty.com/v2/page/api-reference#!/Teams
    interface ITeamsApi {
        listTeams(qs: string): Promise<any>;

        createTeam(payload: any): Promise<any>;

        deleteTeam(id: string, qs: string): Promise<any>;

        getTeam(id: string, qs: string): Promise<any>;

        updateTeam(id: string, payload: any): Promise<any>;

        getTeamMembers(id: string, qs: string): Promise<any>;

        removeEscalationPolicy(id: string, policyid: string): Promise<any>;

        addEscalationPolicy(id: string, policyid: string): Promise<any>;

        removeUser(id: string, userid: string): Promise<any>;

        addUser(id: string, userid: string, payload: any): Promise<any>;
    }

// Users
// https://v2.developer.pagerduty.com/v2/page/api-reference#!/Users
    interface IUsersApi {
        listUsers(qs: string): Promise<any>;

        createUser(from: string, payload: any): Promise<any>;

        deleteUser(id: string): Promise<any>;

        getUser(id: string, qs: string): Promise<any>;

        updateUser(id: string, payload: any): Promise<any>;

        getCurrentUser(qs: string): Promise<any>;

        listContactMethods(id: string): Promise<any>;

        createContactMethod(id: string, payload: any): Promise<any>;

        deleteContactMethod(id: string, contactMethodid: string): Promise<any>;

        getContactMethod(id: string, contactMethodid: string): Promise<any>;

        updateContactMethod(id: string, contactMethodid: string, payload: any): Promise<any>;

        listNotificationRules(id: string, qs: string): Promise<any>;

        createNotificationRule(id: string, payload: any): Promise<any>;

        deleteNotificationRule(id: string, ruleid: string): Promise<any>;

        getNotificationRule(id: string, ruleid: string, qs: string): Promise<any>;

        updateNotificationRule(id: string, ruleid: string, payload: any): Promise<any>;

        deleteAllUserSessions(id: string): Promise<any>;

        listUserActiveSessions(id: string): Promise<any>;

        deleteUsersSession(id: string, type: string, sessionid: string): Promise<any>;

        getUsersSession(id: string, type: string, sessionid: string): Promise<any>;
    }

// Vendors
// https://v2.developer.pagerduty.com/v2/page/api-reference#!/Vendors
    interface IVendorsApi {
        listVendors(): Promise<any>;

        getVendor(id: string): Promise<any>;
    }

    export default class Client {
        constructor(apiToken: string, tokenType?: string, options?: any)

        public addons: IAddonsApi;
        public contextualSearch: IContextualSearchApi;
        public escalationPolicies: IEscalationPoliciesApi;
        public eventRules: IEventRulesApi;
        public extensionSchemas: IExtensionSchemasApi;
        public extensions: IExtensionsApi;
        public events: IEventsApi;
        public incidents: IIncidentsApi;
        public priorities: IPrioritiesApi;
        public responsePlays: IResponsePlaysApi;
        public logEntries: ILogEntriesApi;
        public maintenanceWindows: IMaintenanceWindowsApi;
        public notifications: INotificationsApi;
        public onCalls: IOnCallsApi;
        public schedules: ISchedulesApi;
        public services: IServicesApi;
        public teams: ITeamsApi;
        public users: IUsersApi;
        public vendors: IVendorsApi;
    }
}
