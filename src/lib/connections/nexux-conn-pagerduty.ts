import got from 'got';
import { Connection, ConnectionConfig, GlobalConfig } from '@nexus-switchboard/nexus-extend';
import debug from 'debug';

export const logger = debug('nexus:jira');

export interface IPagerDutyConfig {
    token: string;
    serviceDefault: string;
    escalationPolicyDefault: string;
}

/**
 * https://v2.developer.pagerduty.com/docs/incident-creation-api#making-a-request
 * https://developer.pagerduty.com/api-reference/reference/REST/openapiv3.json/paths/~1incidents/post
*/ 
export interface PagerDutyIncident {
    type: string;
    title: string;
    service: {
        id: string;
        type: string;
    }
    body: {
        type: string;
        details: string;
    }
    escalation_policy: {
        type: string;
        id: string;
    }
}

export interface CreateIncidentPayload {
    headers: {
        From: string;
    }
    incident: PagerDutyIncident
}

export class PagerDutyConnection extends Connection {
    public name = 'Jira';
    public config: IPagerDutyConfig;

    public connect(): PagerDutyConnection {
        return this;
    }

    public disconnect(): boolean {
        return true;
    }

    public async createIncident(payload:CreateIncidentPayload): Promise<PagerDutyIncident>{
        const defaultHeaders = {
            Accept: 'application/vnd.pagerduty+json;version=2',
            Authorization: `Token token=${this.config.token}`,
            'Content-Type': 'application/json'
        }
        try {
            const { body } = await got('https://api.pagerduty.com/incidents', {
                headers: {...defaultHeaders, ...payload.headers},
                json: {
                    incident: payload.incident
                },
                responseType: 'json'
            });
    
            return body.data;
        } catch (e) {
            return e.response.body
        }
        
    }
}

export default function createConnection(cfg: ConnectionConfig, globalCfg: GlobalConfig): Connection {
    return new PagerDutyConnection(cfg, globalCfg);
}