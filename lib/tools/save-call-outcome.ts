/**
 * TOOL 7: save_call_outcome
 * Persists final call outcome, facts, transcript, and computes deterministic lead temperature.
 * Strictly idempotent: replaying the same external_call_id updates without duplicating records.
 */

import { db, DEFAULT_TENANT_ID } from '@/lib/db';
import { SaveCallOutcomeInput, SaveCallOutcomeOutput } from '@/lib/schemas/tools';
import { computeLeadTemperature } from '@/lib/rules/lead-temperature';

export async function executeSaveCallOutcome(
  input: SaveCallOutcomeInput,
  tenantId: string = DEFAULT_TENANT_ID
): Promise<SaveCallOutcomeOutput> {
  try {
    // 1. Resolve customer
    let customerId: string | undefined = undefined;
    let customerName = input.customer_name || 'Inbound Caller';
    let customerPhone = input.customer_phone;

    if (input.customer_phone) {
      const existing = await db.getCustomerByPhone(input.customer_phone, tenantId);
      if (existing) {
        customerId = existing.id;
        customerName = existing.name;
        customerPhone = existing.phone;
      } else {
        const created = await db.createCustomer(
          {
            tenant_id: tenantId,
            phone: input.customer_phone,
            name: input.customer_name || 'Inbound Caller',
          },
          tenantId
        );
        customerId = created.id;
      }
    }

    // 2. Compute deterministic lead temperature
    const leadTemp = computeLeadTemperature({
      intent: input.primary_intent,
      facts: input.facts,
      sentiment: input.sentiment,
      isEscalated: input.escalation_status?.is_escalated,
      hasBookingRequest: Boolean(input.facts?.booking_reference),
    });

    // 3. Idempotency Check on external_call_id
    const existingCall = await db.getCallByExternalId(input.external_call_id, tenantId);
    let callId: string;

    if (existingCall) {
      callId = existingCall.id;
      await db.updateCall(
        callId,
        {
          outcome: input.outcome,
          sentiment: input.sentiment,
          lead_temperature: leadTemp,
          summary: input.summary,
          duration_seconds: input.duration_seconds,
          ended_at: new Date().toISOString(),
          escalation_status: input.escalation_status,
          facts: input.facts ? { call_id: callId, ...input.facts } : existingCall.facts,
          transcript: input.transcript,
        },
        tenantId
      );
    } else {
      const newCall = await db.createCall(
        {
          external_call_id: input.external_call_id,
          tenant_id: tenantId,
          customer_id: customerId,
          started_at: new Date(Date.now() - input.duration_seconds * 1000).toISOString(),
          ended_at: new Date().toISOString(),
          duration_seconds: input.duration_seconds,
          primary_intent: input.primary_intent,
          sentiment: input.sentiment,
          outcome: input.outcome,
          lead_temperature: leadTemp,
          summary: input.summary,
          facts: {
            call_id: '',
            ...input.facts,
          },
          escalation_status: input.escalation_status,
          followup_state: {
            eligible: leadTemp === 'HOT' || leadTemp === 'WARM',
            status: 'PENDING',
          },
          transcript: input.transcript,
          agent_version: 'v1.0.0',
        },
        tenantId
      );
      callId = newCall.id;
    }

    // 4. Update or create Lead record if commercial interest exists and contact is known
    let leadId: string | undefined;
    if ((leadTemp === 'HOT' || leadTemp === 'WARM') && customerPhone) {
      const existingLead = await db.getLeadByCallId(callId, tenantId);
      if (existingLead) {
        leadId = existingLead.id;
        await db.updateLead(
          leadId,
          {
            temperature: leadTemp,
            requirement: input.summary.slice(0, 150),
            route: input.facts?.route_from && input.facts?.route_to ? `${input.facts.route_from} -> ${input.facts.route_to}` : existingLead.route,
            vehicle_type: input.facts?.vehicle_type || existingLead.vehicle_type,
            weight: input.facts?.weight || existingLead.weight,
          },
          tenantId
        );
      } else {
        const newLead = await db.createLead(
          {
            tenant_id: tenantId,
            customer_id: customerId,
            customer_name: customerName,
            phone: customerPhone,
            source: 'INBOUND_CALL',
            status: 'QUALIFIED',
            temperature: leadTemp,
            route: input.facts?.route_from && input.facts?.route_to ? `${input.facts.route_from} -> ${input.facts.route_to}` : undefined,
            vehicle_type: input.facts?.vehicle_type,
            weight: input.facts?.weight,
            requirement: input.summary.slice(0, 150),
            next_action: leadTemp === 'HOT' ? 'Lock booking & assign vehicle' : 'Follow up with corridor quote',
            assigned_to: 'LogiVoice Operations',
            followup_status: 'PENDING',
            last_call_at: new Date().toISOString(),
          },
          tenantId
        );
        leadId = newLead.id;
      }
    }

    // 5. Audit Log
    await db.logAuditEvent(
      {
        tenant_id: tenantId,
        call_id: callId,
        event_type: 'CALL_OUTCOME_SAVED',
        actor: 'AI_AGENT',
        actor_type: 'AI_AGENT',
        actor_id: 'voice-agent',
        tool_name: 'save_call_outcome',
        severity: 'INFO',
        details: {
          external_call_id: input.external_call_id,
          intent: input.primary_intent,
          outcome: input.outcome,
          lead_temperature: leadTemp,
        },
      },
      tenantId
    );

    return {
      status: 'SAVED',
      call_id: callId,
      lead_id: leadId,
      computed_temperature: leadTemp,
      message: `Call outcome successfully persisted. Computed Lead Temperature: ${leadTemp}.`,
    };
  } catch (error) {
    console.error('[SaveCallOutcomeTool] Internal error during execution:', error);
    return {
      status: 'FAILED',
      message: 'Call outcome persistence temporarily unavailable.',
    };
  }
}
