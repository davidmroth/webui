# AgentLens Feedback Loop SOP/MOP

This runbook describes the operational loop for validating a WebUI conversation by pushing a message through the platform, then pulling telemetry and logs from the proxy and AgentLens as the turn flows through the stack.

The key idea is simple: the WebUI maintenance sidedoor is the trigger surface, and AgentLens/proxy telemetry is the observation surface. The trigger is not the analysis result. The analysis result is what you retrieve after the message has propagated through the platform.

## When to Use

Use this procedure when you need to:

- Validate that a message sent through WebUI actually reaches the proxy and downstream inference stack.
- Confirm whether a turn was processed correctly, stalled, timed out, or failed.
- Measure performance regressions, cache behavior, or restore-chain behavior for a real conversation.
- Correlate a user-visible chat event with backend telemetry and logs.

Do not use this workflow as a synthetic shortcut that bypasses the platform. The whole point is to observe the live flow of a real message through the system.

## Scope

This runbook covers the following surfaces:

- WebUI maintenance sidedoor for triggering or inspecting a run.
- WebUI chat conversation state for the visible user experience.
- AgentLens telemetry for run lifecycle, timing, and pass criteria.
- Proxy logs and response timing for the actual inference path.

It does not replace normal app testing, and it does not change the production chat path.

## Topology

The intended control loop is:

1. Trigger a conversation-backed message or validation run from WebUI maintenance or chat.
2. Let the message move through WebUI, proxy, and the model backend.
3. Pull telemetry from AgentLens and proxy logs once the event has propagated.
4. Compare the visible chat result, backend timings, and telemetry markers.

If the deployment environment cannot reach AgentLens directly, the loop must be run from the same network segment as AgentLens, or AgentLens telemetry must be exported through a relay that the WebUI can reach. Do not assume a cloud-hosted WebUI can directly poll a local AgentLens service.

## Prerequisites

- A valid WebUI maintenance session.
- A conversation id to test.
- AgentLens telemetry reachable from the environment that is performing the analysis.
- Proxy logs available for the same time window.
- The test environment must know the correct AgentLens base URL if direct access is supported.

Recommended local environment variables:

- `AGENTLENS_BASE_URL`
- `AGENTLENS_TESTING_ENABLED`
- `AGENTLENS_TESTING_API_KEY` if the AgentLens endpoint is protected
- `AGENTLENS_TESTING_TIMEOUT_MS`

## SOP

### 1. Trigger the run

Open the WebUI maintenance surface and start the validation run for the target conversation.

Use the maintenance sidedoor because it is the control plane, not the observation plane.

Expected result:

- A run id is created.
- The run status begins as queued or running.
- The conversation id is recorded on the run.

### 2. Let the message flow through the stack

Allow the turn to propagate normally through:

- WebUI message ingestion.
- Proxy request handling.
- Model/backend execution.
- Any restore-chain or cache behavior in the inference path.

Do not inject fake telemetry to force a success state. The validation is only meaningful if the live system emits the signals itself.

### 3. Pull telemetry

After the message has been sent, collect the backend observations:

- AgentLens run state.
- Turn-level status and duration.
- Prompt and completion token counts if available.
- Prefill latency and cache indicators.
- Proxy logs for request timing and errors.
- WebUI maintenance or conversation telemetry if available.

What matters is not a single metric. What matters is the relationship between the user-visible turn and the backend evidence.

### 4. Compare the surfaces

Confirm the following align:

- The conversation changed in WebUI.
- The run exists in AgentLens.
- The proxy saw the corresponding request.
- The telemetry timeline matches the time the message was sent.
- Any failure has a concrete backend reason, not a vague missing signal.

## MOP

Use the MOP when the SOP does not produce a clean result.

### If the run never starts

Check:

- WebUI maintenance auth.
- AgentLens reachability from the analysis environment.
- The configured AgentLens base URL.
- Whether the feature is enabled in the deployment where you are trying to observe it.

### If the run starts but turns never appear

Check:

- Proxy connectivity to the model backend.
- Proxy request logs for timeout or connection failures.
- AgentLens run output for early transport errors.
- Whether the run is waiting on a service that is not actually reachable from the deployment.

### If the run completes but looks wrong

Check:

- Whether the pass criteria are correctly treating transport failures as failures.
- Whether turn durations are actually populated.
- Whether telemetry markers like cache hits, restore-chain traces, or timing values are present.
- Whether the run is measuring a real model path or only a local transport stub.

### If WebUI shows no progress

This usually means one of three things:

- The environment cannot reach AgentLens directly.
- The progress lookup is disabled by configuration.
- The run exists, but the UI is looking at the wrong deployment boundary.

In that case, do not force the cloud WebUI to talk to local AgentLens. Move the observability surface to the same network boundary as the telemetry source, or relay the telemetry into a reachable service.

## Pass Criteria

Treat the loop as successful only when the following are true:

- The message was pushed through the real WebUI path.
- The proxy received the corresponding request.
- AgentLens recorded the run and turn data.
- The telemetry is sufficient to explain success or failure.
- Performance numbers are present when expected.

For debugging, the most useful signals are usually:

- turn status
- turn duration
- timing metadata
- cache or restore-chain markers
- proxy error text

## Failure Modes

Common failure modes include:

- WebUI can trigger the run but cannot reach AgentLens for progress lookup.
- AgentLens can see the run but the proxy cannot reach the model backend.
- The turn completes but telemetry is missing because the wrong deployment boundary is being observed.
- A transport error is incorrectly interpreted as success.

## Operational Notes

- The sidedoor trigger is for starting and inspecting runs, not for fabricating results.
- The telemetry source must be reachable from the analysis environment.
- If the environment is cloud-hosted and AgentLens is local-only, the direct polling model is invalid unless you add a relay or move the observer into the same network.
- The analysis should focus on the relationship between the message, the proxy, and AgentLens, not on any single artifact in isolation.

## References

- WebUI maintenance route: `/maintenance/agentlens/testing`
- WebUI chat route: `/chat?conversation=<conversation-id>`
- AgentLens testing API: `/api/v1/testing/runs`
- Proxy health: `/health`
