// import {
//     ACTION_CANCEL_REQUEST,
//     ACTION_CLAIM_REQUEST,
//     ACTION_COMMENT_ON_REQUEST,
//     ACTION_COMPLETE_REQUEST,
//     ACTION_PAGE_REQUEST, FLOW_CONTINUE,
//     FlowAction, FlowBehavior, FlowState,
//     ServiceFlow, STATE_NO_TICKET
// } from ".";
//
// import moduleInstance, {logger} from "../../index";
// import {delay, noop} from "../util";
// import ServiceRequest, {cancelButton, completeButton, IssueAction, viewButton} from "../request";
//
// import {getNestedVal} from "@nexus-switchboard/nexus-extend";
// import Orchestrator from "./orchestrator";
//
// export const STATE_CLAIMED: FlowState = "claimed";
// export const STATE_COMPLETED: FlowState = "completed";
// export const STATE_CANCELLED: FlowState = "cancelled";
//
// export class ClaimFlow extends ServiceFlow {
//
//     protected _getFlowActions(_payload: any, _additionalData: any): FlowAction[] {
//         return [ACTION_CLAIM_REQUEST, ACTION_CANCEL_REQUEST,
//             ACTION_COMPLETE_REQUEST, ACTION_COMMENT_ON_REQUEST,
//             ACTION_PAGE_REQUEST]
//     }
//
//     protected _handleAsyncResponse(request: ServiceRequest, action: FlowAction, payload: any, _additionalData: any): Promise<void> {
//
//         if (action === ACTION_CLAIM_REQUEST) {
//             Orchestrator.setControlFlow(request.ticket.key, ACTION_CLAIM_REQUEST, "deny");
//             request.claim().then((request: ServiceRequest )=>{
//                 this._setRequestState(request);
//                 request.updateSlackThread().then(noop);
//             }).finally(()=>{
//                 delay(2000).then(()=>{Orchestrator.setControlFlow(request.ticket.key, ACTION_CLAIM_REQUEST, "allow");});
//             });
//         } else if (action == ACTION_CANCEL_REQUEST) {
//             Orchestrator.setControlFlow(request.ticket.key, ACTION_CANCEL_REQUEST, "deny");
//             request.cancel().then((request: ServiceRequest )=>{
//                 this._setRequestState(request);
//                 request.updateSlackThread().then(noop);
//             }).finally(()=>{
//                 delay(2000).then(()=>{Orchestrator.setControlFlow(request.ticket.key, ACTION_CANCEL_REQUEST, "allow");});
//             });
//         } else if (action == ACTION_COMPLETE_REQUEST) {
//             Orchestrator.setControlFlow(request.ticket.key, ACTION_COMPLETE_REQUEST, "deny");
//             request.complete().then((request: ServiceRequest )=>{
//                 this._setRequestState(request);
//                 request.updateSlackThread().then(noop);
//             }).finally(()=>{
//                 delay(2000).then(()=>{Orchestrator.setControlFlow(request.ticket.key, ACTION_COMPLETE_REQUEST, "allow");});
//             });
//         } else if (action == ACTION_COMMENT_ON_REQUEST) {
//             request.commentFromSlack(payload).then(noop);
//         } else if (action == ACTION_PAGE_REQUEST) {
//             request.createPagerDutyAlert(payload).then(noop);
//         } else {
//             logger("An unrecognized action was triggered in the Flow Orchestrator: " + action);
//         }
//
//         return Promise.resolve();
//     }
//
//     public _handleSyncResponse(action: FlowAction, payload: any, _additionalData: any): FlowBehavior {
//
//         if (action === ACTION_PAGE_REQUEST) {
//             // This action is triggered by a user clicking on a button in a
//             //  request thread.  The immediate response for this (before any action is attempted)
//             //  is to remove the page button to ensure the user doesn't click it multiple
//             //  times.
//             const newBlocks = payload.message.blocks.filter((b: any) => {
//                 return (b.block_id === "request_description" ||
//                     b.block_id === "high_priority_warning")
//             });
//             newBlocks.push({
//                 type: "section",
//                 block_id: "page_request_completed",
//                 text: {
//                     type: "mrkdwn",
//                     text: moduleInstance.getActiveModuleConfig().REQUEST_ON_CALL_PRESSED_MSG
//                 }
//             })
//             moduleInstance.getSlack().sendMessageResponse(payload, {
//                 replace_original: true,
//                 blocks: newBlocks
//             });
//         }
//
//         return FLOW_CONTINUE;
//     }
//
//     protected _setRequestState(request: ServiceRequest): FlowState {
//
//         let state: FlowState;
//         if (!request || !request.ticket) {
//             state = STATE_NO_TICKET;
//         } else {
//             const jira = moduleInstance.getJira();
//             const config = moduleInstance.getActiveModuleConfig();
//             const actions: IssueAction[] = [];
//
//             const vb = Object.assign({}, viewButton);
//             vb.url = jira.keyToWebLink(config.jira_HOST, request.ticket.key);
//
//             const cat: string = getNestedVal(request.ticket, "fields.status.statusCategory.name");
//
//             if (["indeterminate", "in progress"].indexOf(cat.toLowerCase()) >= 0) {
//                 state = STATE_CLAIMED;
//                 actions.push(completeButton, cancelButton, vb)
//             }
//
//             if (["complete", "done"].indexOf(cat.toLowerCase()) >= 0) {
//                 const resolution: string = getNestedVal(request.ticket, "fields.resolution.name");
//                 if (resolution) {
//                     if (resolution.toLowerCase() === config.REQUEST_JIRA_RESOLUTION_DONE.toLowerCase()) {
//                         state = STATE_COMPLETED;
//                     } else {
//                         state = STATE_CANCELLED;
//                     }
//                 } else {
//                     // if there is no resolution set then go ahead
//                     //  and mark it as complete.
//                     state = STATE_COMPLETED;
//                 }
//
//                 actions.push(newViewButton);
//             }
//         }
//
//         if (state) {
//             request.state = state;
//             request.setAvailableActions()
//         }
//
//         return state;
//     }
//
// }
