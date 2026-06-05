# Security Review & Hardening

This document tracks the security findings from the review of the FinOps Agent infrastructure, their resolution status, and recommendations for production deployments.

---

## Resolved Findings

### 1. [HIGH] Billing MCP Runtime — Wildcard IAM permissions

**Finding:** `ce:*`, `budgets:*`, `compute-optimizer:*`, `freetier:*`, `cost-optimization-hub:*` included destructive actions (Create/Update/Delete monitors, budgets, enrollment status).

**Resolution:** Replaced all wildcards with explicit read-only actions (`Get*`, `List*`, `Describe*`). The Billing MCP server only needs read access for FinOps analysis.

**File:** `cdk/lib/mcp-runtime-stack.ts` (lines 97–160)

---

### 2. [HIGH] Data Processing MCP — Excessive write access and handler surface

**Finding:** The server started with `allow_write=True` and `allow_sensitive_data_access=True`, enabling writes to EMR, Glue ETL jobs, crawlers, triggers. For CUR queries, 90% of handlers were unnecessary.

**Resolution:**
- Changed to `allow_write=False`
- Removed all EMR, Glue ETL, Crawler, Interactive Sessions, Workflow/Trigger, and Commons handlers
- Only 4 handlers remain: `AthenaQueryHandler`, `AthenaDataCatalogHandler`, `AthenaWorkGroupHandler`, `GlueDataCatalogHandler`
- IAM permissions already scoped to specific workgroup, database, table, and S3 buckets

**File:** `codebuild-scripts/transform-dataprocessing.sh` (main function patch)

---

### 3. [HIGH] Cognito Authenticated Role — Gateway bypass vector

**Finding:** The Cognito Authenticated Role allowed users to invoke `finops_billing_mcp*` and `finops_pricing_mcp*` runtimes directly, bypassing the Gateway orchestrator. MCP runtimes should only be reachable via the Gateway (M2M JWT).

**Resolution:** Removed `finops_billing_mcp*` and `finops_pricing_mcp*` from the Authenticated Role resources. Users can only invoke `finops_runtime*` (the main agent that routes through the Gateway).

**File:** `cdk/lib/auth-stack.ts` (lines 188–200)

---

### 6. [MEDIUM] Redundant wildcard managed policy on Gateway role

**Finding:** The Gateway role had a managed policy with `bedrock-agentcore:GetWorkloadAccessToken` and `GetResourceOauth2Token` on `Resource: *`, plus a separate scoped statement on the OAuth provider ARN. The wildcard was redundant.

**Resolution:** Removed the wildcard managed policy entirely. The scoped inline statement (on the OAuth provider ARN and secret ARN) is sufficient.

**File:** `cdk/lib/gateway-stack.ts` (removed `GatewayTokenExchangePolicy`)

---

### 14. [LOW] M2M client in Identity Pool providers

**Finding:** The M2M client (used for Gateway→MCP server OAuth) was included as a Cognito Identity Pool provider. M2M clients don't use federated identity and this configuration was confusing — it could potentially be exploited if someone attempted to use it for credential exchange.

**Resolution:** Removed M2M client from the Identity Pool's `cognitoIdentityProviders`. Only the frontend user pool client remains.

**File:** `cdk/lib/auth-stack.ts` (Identity Pool configuration)

---

## Pending — Production Recommendations

### 4. [MEDIUM] MFA and Advanced Security disabled in Cognito

**Status:** Suppressed as "demo/development environment" in CDK-Nag.

**Recommendation:** For production deployments:
```typescript
// In auth-stack.ts UserPool configuration:
mfa: cognito.Mfa.REQUIRED,
mfaSecondFactor: { sms: true, otp: true },
userPoolAddOns: { advancedSecurityMode: cognito.AdvancedSecurityMode.ENFORCED },
```

---

### 5. [MEDIUM] Public network mode on AgentCore Runtimes

**Status:** All runtimes use `NetworkMode: 'PUBLIC'`. Security relies on JWT authorization for MCP runtimes and IAM for the main runtime.

**Recommendation:** If AgentCore supports VPC/PRIVATE network mode, consider using it for environments processing sensitive data (CUR contains resource ARNs, internal IDs).

---

### 7. [MEDIUM] OAuth Provider Lambda — broad permissions with Resource: *

**Status:** The Lambda uses `bedrock-agentcore:Create/Delete/GetOauth2CredentialProvider` and `CreateTokenVault/GetTokenVault` with `Resource: *`. The `Delete*` action is destructive.

**Limitation:** AgentCore Identity does not currently support resource-level ARNs for these actions.

**Recommendation:** When ARN support is added, scope the resources. In the meantime, consider adding:
```typescript
conditions: {
  StringEquals: { 'aws:CalledVia': ['cloudformation.amazonaws.com'] }
}
```

---

### 8. [MEDIUM] Supply chain — unpinned git clone in transform scripts

**Status:** `transform-*.sh` scripts run `git clone --depth 1 https://github.com/awslabs/mcp.git` without pinning to a specific commit. Each `cdk deploy` downloads HEAD of `main`.

**Risk:** A compromised commit upstream would be baked into the container image.

**Recommendation:** Pin to a known commit SHA:
```bash
git clone https://github.com/awslabs/mcp.git && cd mcp && git checkout <SHA>
```
The upstream repo uses date-based tags (`2026.05.20260529200555`) which can also be used but are less ergonomic.

**Trade-off:** Pinning requires manual updates to receive upstream fixes.

---

### 9. [MEDIUM] CodeBuild with privileged: true

**Status:** Required for docker-in-docker to build container images.

**Risk:** A compromised build project grants root access within the build container.

**Recommendation:** Consider migrating to Kaniko or Finch for unprivileged container builds. This requires changes to the buildspec and base image.

---

### 10. [MEDIUM] logs:DescribeLogGroups with log-group:*

**Status:** The `DescribeLogGroups` action does not support resource-level scoping in IAM (AWS limitation). Other log actions are already scoped to `/aws/bedrock-agentcore/runtimes/*`.

**Recommendation:** No action needed — this is an AWS API limitation, not a misconfiguration.

---

### 11. [LOW] No KMS CMK encryption

**Status:** CodeBuild, ECR, and CloudWatch Logs use AWS-managed encryption (SSE-S3, default). Suppressed as demo in CDK-Nag.

**Recommendation:** For production, add CMK encryption:
- ECR: `encryption: ecr.RepositoryEncryption.KMS`
- CodeBuild: `encryptionKey: kms.Key`
- S3: `encryption: s3.BucketEncryption.KMS`

---

### 12. [LOW] RemovalPolicy.DESTROY on ECR and S3

**Status:** `RemovalPolicy.DESTROY` + `emptyOnDelete: true` + `autoDeleteObjects: true` means `cdk destroy` permanently deletes all data without recovery.

**Recommendation:** For production, use `RemovalPolicy.RETAIN` on data stores.

---

### 13. [LOW] M2M client secret exposure via Custom Resource

**Status:** The M2M client secret is read by `AwsCustomResource (DescribeUserPoolClient)` and passed to the OAuth Provider Lambda. The value passes through CloudFormation response and could appear in CloudWatch logs at elevated log levels.

**Mitigation:** The secret is ultimately stored in Secrets Manager under `bedrock-agentcore-identity*`. The Custom Resource runs at deploy-time only.

**Recommendation:** Ensure CloudWatch log groups for custom resource Lambdas have restricted access. Consider using a Secrets Manager reference directly if the AgentCore API supports it in the future.

---

### 15. [LOW] S3 source bucket without server access logging

**Status:** Suppressed in CDK-Nag. The bucket contains only build scripts (non-sensitive).

**Recommendation:** Enable access logging for audit compliance in production.

---

### 16. [LOW] No WAF/rate limiting

**Status:** A valid authenticated user can invoke the agent in a loop, generating Bedrock + Athena costs.

**Recommendation:** Implement one or more of:
- Cognito usage limits per user (custom Lambda authorizer)
- API Gateway in front of the frontend with throttling
- Budget alerts to detect unexpected cost spikes
- AgentCore Runtime timeout (already set to 15min by default)

---

## Summary

| Priority | Total | Resolved | Pending |
|----------|-------|----------|---------|
| High     | 3     | 3        | 0       |
| Medium   | 7     | 2        | 5       |
| Low      | 6     | 1        | 5       |

All **High** priority findings have been resolved. The remaining **Medium** and **Low** items are production hardening recommendations that don't affect the core functionality or pose immediate security risks in a controlled demo/POC environment.
