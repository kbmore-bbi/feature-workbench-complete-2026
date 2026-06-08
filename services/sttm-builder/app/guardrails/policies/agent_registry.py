from __future__ import annotations

from app.core.exceptions import AuthorizationError
from app.guardrails.config.schema import AgentPolicyConfig, GuardrailsConfig


class AgentRegistry:
    def __init__(self, config: GuardrailsConfig) -> None:
        self._config = config

    def get(self, agent_id: str) -> AgentPolicyConfig:
        policy = self._config.agents.get(agent_id)
        if policy is None:
            raise AuthorizationError(f"Unknown guardrails agent '{agent_id}'.")
        return policy

    def assert_call_allowed(self, *, agent_id: str, caller: str, operation: str) -> AgentPolicyConfig:
        policy = self.get(agent_id)
        if policy.allowed_callers and caller not in policy.allowed_callers:
            raise AuthorizationError(f"Caller '{caller}' is not allowed to invoke agent '{agent_id}'.")
        if policy.allowed_operations and operation not in policy.allowed_operations:
            raise AuthorizationError(f"Operation '{operation}' is not allowed for agent '{agent_id}'.")
        return policy

    def assert_delegate_allowed(self, *, agent_id: str, downstream_agent: str) -> None:
        policy = self.get(agent_id)
        if policy.allowed_downstream_agents and downstream_agent not in policy.allowed_downstream_agents:
            raise AuthorizationError(
                f"Agent '{agent_id}' is not allowed to delegate to '{downstream_agent}'."
            )
