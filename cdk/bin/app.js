#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
require("source-map-support/register");
const cdk = __importStar(require("aws-cdk-lib"));
const aws_cdk_lib_1 = require("aws-cdk-lib");
const cdk_nag_1 = require("cdk-nag");
const image_stack_1 = require("../lib/image-stack");
const auth_stack_1 = require("../lib/auth-stack");
const mcp_runtime_stack_1 = require("../lib/mcp-runtime-stack");
const gateway_stack_1 = require("../lib/gateway-stack");
const agent_runtime_stack_1 = require("../lib/agent-runtime-stack");
const app = new cdk.App();
// Add CDK-Nag AWS Solutions checks
aws_cdk_lib_1.Aspects.of(app).add(new cdk_nag_1.AwsSolutionsChecks({ verbose: true }));
// Get configuration from context or environment
const env = {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
};
const adminEmail = process.env.ADMIN_EMAIL || app.node.tryGetContext('adminEmail');
if (!adminEmail) {
    console.error('\n❌ ERROR: ADMIN_EMAIL environment variable is required.');
    console.error('Please set it before deploying:');
    console.error('  export ADMIN_EMAIL="your-email@example.com"');
    console.error('  cdk deploy\n');
    throw new Error('ADMIN_EMAIL environment variable is required. Set it before deploying.');
}
// Data Processing MCP configuration (required)
const athenaDatabase = process.env.ATHENA_DATABASE || app.node.tryGetContext('athenaDatabase');
const athenaTable = process.env.ATHENA_TABLE || app.node.tryGetContext('athenaTable');
const athenaOutputBucket = process.env.ATHENA_OUTPUT_BUCKET || app.node.tryGetContext('athenaOutputBucket');
const curS3Bucket = process.env.CUR_S3_BUCKET || app.node.tryGetContext('curS3Bucket');
const curS3Prefix = process.env.CUR_S3_PREFIX || app.node.tryGetContext('curS3Prefix') || '';
if (!athenaDatabase || !athenaTable || !athenaOutputBucket || !curS3Bucket) {
    console.error('\n❌ ERROR: Data Processing MCP configuration is required.');
    console.error('Please set the following environment variables before deploying:');
    console.error('  export ATHENA_DATABASE="your-cur-database"');
    console.error('  export ATHENA_TABLE="your-cur-table"');
    console.error('  export ATHENA_OUTPUT_BUCKET="s3://your-athena-results-bucket"');
    console.error('  export CUR_S3_BUCKET="your-cur-s3-bucket"');
    console.error('  export CUR_S3_PREFIX="optional/prefix/"  (optional)\n');
    throw new Error('ATHENA_DATABASE, ATHENA_TABLE, ATHENA_OUTPUT_BUCKET, and CUR_S3_BUCKET are required.');
}
// ========================================
// Validated Deployment Sequence
// ========================================
// Stack 1: Image Stack - Builds Docker images for Agent Runtimes
const imageStack = new image_stack_1.ImageStack(app, 'FinOpsImageStack', {
    env,
    description: 'FinOps Agent - Docker Image Build (ECR + CodeBuild)',
});
// Stack 2: Auth Stack - Cognito + M2M + OAuth Provider (Custom Resource)
const authStack = new auth_stack_1.AuthStack(app, 'FinOpsAuthStack', {
    env,
    description: 'FinOps Agent - Cognito Authentication + OAuth Provider',
    adminEmail: adminEmail,
});
// Stack 3: MCP Runtime Stack - Deploy 2 MCP Runtimes with JWT auth
const mcpRuntimeStack = new mcp_runtime_stack_1.MCPRuntimeStack(app, 'FinOpsMCPRuntimeStack', {
    env,
    description: 'FinOps Agent - MCP Server Runtimes (Billing + Pricing + Data Processing) with JWT Authorization',
    billingMcpRepository: imageStack.billingMcpRepository,
    pricingMcpRepository: imageStack.pricingMcpRepository,
    dataProcessingMcpRepository: imageStack.dataProcessingMcpRepository,
    userPoolId: authStack.userPoolId,
    m2mClientId: authStack.oauthClientId,
    athenaDatabase,
    athenaTable,
    athenaOutputBucket,
    curS3Bucket,
    curS3Prefix,
});
mcpRuntimeStack.addDependency(imageStack);
mcpRuntimeStack.addDependency(authStack);
// Stack 4: AgentCore Gateway Stack - Gateway + its own Cognito + OAuth provider + MCP targets
const agentCoreGatewayStack = new gateway_stack_1.AgentCoreGatewayStack(app, 'FinOpsAgentCoreGatewayStack', {
    env,
    description: 'FinOps Agent - Gateway with MCP Server Targets',
    billingMcpRuntimeArn: mcpRuntimeStack.billingMcpRuntimeArn,
    pricingMcpRuntimeArn: mcpRuntimeStack.pricingMcpRuntimeArn,
    billingMcpRuntimeEndpoint: mcpRuntimeStack.billingMcpRuntimeEndpoint,
    pricingMcpRuntimeEndpoint: mcpRuntimeStack.pricingMcpRuntimeEndpoint,
    dataProcessingMcpRuntimeArn: mcpRuntimeStack.dataProcessingMcpRuntimeArn,
    dataProcessingMcpRuntimeEndpoint: mcpRuntimeStack.dataProcessingMcpRuntimeEndpoint,
    // AuthStack Cognito for outbound OAuth to runtimes
    authUserPoolId: authStack.userPoolId,
    authUserPoolArn: authStack.userPoolArn,
    authM2mClientId: authStack.oauthClientId,
});
agentCoreGatewayStack.addDependency(mcpRuntimeStack);
agentCoreGatewayStack.addDependency(authStack);
// Stack 5: Main Runtime Stack - Main agent runtime with Gateway ARN
const agentRuntimeStack = new agent_runtime_stack_1.AgentRuntimeStack(app, 'FinOpsAgentRuntimeStack', {
    env,
    description: 'FinOps Agent - Main Agent Runtime with Gateway Integration',
    repository: imageStack.repository,
    userPoolArn: authStack.userPoolArn,
    gatewayArn: agentCoreGatewayStack.gatewayArn,
    userPoolId: authStack.userPoolId,
    userPoolClientId: authStack.userPoolClientId,
    identityPoolId: authStack.identityPoolId,
});
agentRuntimeStack.addDependency(imageStack);
agentRuntimeStack.addDependency(authStack);
agentRuntimeStack.addDependency(agentCoreGatewayStack);
// Add tags to all stacks
cdk.Tags.of(app).add('Project', 'FinOpsAgent');
cdk.Tags.of(app).add('ManagedBy', 'CDK');
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYXBwLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUNBLHVDQUFxQztBQUNyQyxpREFBbUM7QUFDbkMsNkNBQXNDO0FBQ3RDLHFDQUE2QztBQUM3QyxvREFBZ0Q7QUFDaEQsa0RBQThDO0FBQzlDLGdFQUEyRDtBQUMzRCx3REFBNkQ7QUFDN0Qsb0VBQStEO0FBRS9ELE1BQU0sR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsRUFBRSxDQUFDO0FBRTFCLG1DQUFtQztBQUNuQyxxQkFBTyxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsSUFBSSw0QkFBa0IsQ0FBQyxFQUFFLE9BQU8sRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUM7QUFFL0QsZ0RBQWdEO0FBQ2hELE1BQU0sR0FBRyxHQUFHO0lBQ1YsT0FBTyxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsbUJBQW1CO0lBQ3hDLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLGtCQUFrQixJQUFJLFdBQVc7Q0FDdEQsQ0FBQztBQUVGLE1BQU0sVUFBVSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsV0FBVyxJQUFJLEdBQUcsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLFlBQVksQ0FBQyxDQUFDO0FBRW5GLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQztJQUNoQixPQUFPLENBQUMsS0FBSyxDQUFDLDBEQUEwRCxDQUFDLENBQUM7SUFDMUUsT0FBTyxDQUFDLEtBQUssQ0FBQyxpQ0FBaUMsQ0FBQyxDQUFDO0lBQ2pELE9BQU8sQ0FBQyxLQUFLLENBQUMsK0NBQStDLENBQUMsQ0FBQztJQUMvRCxPQUFPLENBQUMsS0FBSyxDQUFDLGdCQUFnQixDQUFDLENBQUM7SUFDaEMsTUFBTSxJQUFJLEtBQUssQ0FBQyx3RUFBd0UsQ0FBQyxDQUFDO0FBQzVG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Q0FBQyxHQUFHLENBQUMsU0FBUyxFQUFFLGFBQWEsQ0FBQyxDQUFDO0FBQy9DLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxXQUFXLEVBQUUsS0FBSyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIjIS91c3IvYmluL2VudiBub2RlXG5pbXBvcnQgJ3NvdXJjZS1tYXAtc3VwcG9ydC9yZWdpc3Rlcic7XG5pbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgQXNwZWN0cyB9IGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IEF3c1NvbHV0aW9uc0NoZWNrcyB9IGZyb20gJ2Nkay1uYWcnO1xuaW1wb3J0IHsgSW1hZ2VTdGFjayB9IGZyb20gJy4uL2xpYi9pbWFnZS1zdGFjayc7XG5pbXBvcnQgeyBBdXRoU3RhY2sgfSBmcm9tICcuLi9saWIvYXV0aC1zdGFjayc7XG5pbXBvcnQgeyBNQ1BSdW50aW1lU3RhY2sgfSBmcm9tICcuLi9saWIvbWNwLXJ1bnRpbWUtc3RhY2snO1xuaW1wb3J0IHsgQWdlbnRDb3JlR2F0ZXdheVN0YWNrIH0gZnJvbSAnLi4vbGliL2dhdGV3YXktc3RhY2snO1xuaW1wb3J0IHsgQWdlbnRSdW50aW1lU3RhY2sgfSBmcm9tICcuLi9saWIvYWdlbnQtcnVudGltZS1zdGFjayc7XG5cbmNvbnN0IGFwcCA9IG5ldyBjZGsuQXBwKCk7XG5cbi8vIEFkZCBDREstTmFnIEFXUyBTb2x1dGlvbnMgY2hlY2tzXG5Bc3BlY3RzLm9mKGFwcCkuYWRkKG5ldyBBd3NTb2x1dGlvbnNDaGVja3MoeyB2ZXJib3NlOiB0cnVlIH0pKTtcblxuLy8gR2V0IGNvbmZpZ3VyYXRpb24gZnJvbSBjb250ZXh0IG9yIGVudmlyb25tZW50XG5jb25zdCBlbnYgPSB7XG4gIGFjY291bnQ6IHByb2Nlc3MuZW52LkNES19ERUZBVUxUX0FDQ09VTlQsXG4gIHJlZ2lvbjogcHJvY2Vzcy5lbnYuQ0RLX0RFRkFVTFRfUkVHSU9OIHx8ICd1cy1lYXN0LTEnLFxufTtcblxuY29uc3QgYWRtaW5FbWFpbCA9IHByb2Nlc3MuZW52LkFETUlOX0VNQUlMIHx8IGFwcC5ub2RlLnRyeUdldENvbnRleHQoJ2FkbWluRW1haWwnKTtcblxuaWYgKCFhZG1pbkVtYWlsKSB7XG4gIGNvbnNvbGUuZXJyb3IoJ1xcbuKdjCBFUlJPUjogQURNSU5fRU1BSUwgZW52aXJvbm1lbnQgdmFyaWFibGUgaXMgcmVxdWlyZWQuJyk7XG4gIGNvbnNvbGUuZXJyb3IoJ1BsZWFzZSBzZXQgaXQgYmVmb3JlIGRlcGxveWluZzonKTtcbiAgY29uc29sZS5lcnJvcignICBleHBvcnQgQURNSU5fRU1BSUw9XCJ5b3VyLWVtYWlsQGV4YW1wbGUuY29tXCInKTtcbiAgY29uc29sZS5lcnJvcignICBjZGsgZGVwbG95XFxuJyk7XG4gIHRocm93IG5ldyBFcnJvcignQURNSU5fRU1BSUwgZW52aXJvbm1lbnQgdmFyaWFibGUgaXMgcmVxdWlyZWQuIFNldCBpdCBiZWZvcmUgZGVwbG95aW5nLicpO1xufVxuXG4vLyBEYXRhIFByb2Nlc3NpbmcgTUNQIGNvbmZpZ3VyYXRpb24gKHJlcXVpcmVkKVxuY29uc3QgYXRoZW5hRGF0YWJhc2UgPSBwcm9jZXNzLmVudi5BVEhFTkFfREFUQUJBU0UgfHwgYXBwLm5vZGUudHJ5R2V0Q29udGV4dCgnYXRoZW5hRGF0YWJhc2UnKTtcbmNvbnN0IGF0aGVuYVRhYmxlID0gcHJvY2Vzcy5lbnYuQVRIRU5BX1RBQkxFIHx8IGFwcC5ub2RlLnRyeUdldENvbnRleHQoJ2F0aGVuYVRhYmxlJyk7XG5jb25zdCBhdGhlbmFPdXRwdXRCdWNrZXQgPSBwcm9jZXNzLmVudi5BVEhFTkFfT1VUUFVUX0JVQ0tFVCB8fCBhcHAubm9kZS50cnlHZXRDb250ZXh0KCdhdGhlbmFPdXRwdXRCdWNrZXQnKTtcbmNvbnN0IGN1clMzQnVja2V0ID0gcHJvY2Vzcy5lbnYuQ1VSX1MzX0JVQ0tFVCB8fCBhcHAubm9kZS50cnlHZXRDb250ZXh0KCdjdXJTM0J1Y2tldCcpO1xuY29uc3QgY3VyUzNQcmVmaXggPSBwcm9jZXNzLmVudi5DVVJfUzNfUFJFRklYIHx8IGFwcC5ub2RlLnRyeUdldENvbnRleHQoJ2N1clMzUHJlZml4JykgfHwgJyc7XG5cbmlmICghYXRoZW5hRGF0YWJhc2UgfHwgIWF0aGVuYVRhYmxlIHx8ICFhdGhlbmFPdXRwdXRCdWNrZXQgfHwgIWN1clMzQnVja2V0KSB7XG4gIGNvbnNvbGUuZXJyb3IoJ1xcbuKdjCBFUlJPUjogRGF0YSBQcm9jZXNzaW5nIE1DUCBjb25maWd1cmF0aW9uIGlzIHJlcXVpcmVkLicpO1xuICBjb25zb2xlLmVycm9yKCdQbGVhc2Ugc2V0IHRoZSBmb2xsb3dpbmcgZW52aXJvbm1lbnQgdmFyaWFibGVzIGJlZm9yZSBkZXBsb3lpbmc6Jyk7XG4gIGNvbnNvbGUuZXJyb3IoJyAgZXhwb3J0IEFUSEVOQV9EQVRBQkFTRT1cInlvdXItY3VyLWRhdGFiYXNlXCInKTtcbiAgY29uc29sZS5lcnJvcignICBleHBvcnQgQVRIRU5BX1RBQkxFPVwieW91ci1jdXItdGFibGVcIicpO1xuICBjb25zb2xlLmVycm9yKCcgIGV4cG9ydCBBVEhFTkFfT1VUUFVUX0JVQ0tFVD1cInMzOi8veW91ci1hdGhlbmEtcmVzdWx0cy1idWNrZXRcIicpO1xuICBjb25zb2xlLmVycm9yKCcgIGV4cG9ydCBDVVJfUzNfQlVDS0VUPVwieW91ci1jdXItczMtYnVja2V0XCInKTtcbiAgY29uc29sZS5lcnJvcignICBleHBvcnQgQ1VSX1MzX1BSRUZJWD1cIm9wdGlvbmFsL3ByZWZpeC9cIiAgKG9wdGlvbmFsKVxcbicpO1xuICB0aHJvdyBuZXcgRXJyb3IoJ0FUSEVOQV9EQVRBQkFTRSwgQVRIRU5BX1RBQkxFLCBBVEhFTkFfT1VUUFVUX0JVQ0tFVCwgYW5kIENVUl9TM19CVUNLRVQgYXJlIHJlcXVpcmVkLicpO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBWYWxpZGF0ZWQgRGVwbG95bWVudCBTZXF1ZW5jZVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vLyBTdGFjayAxOiBJbWFnZSBTdGFjayAtIEJ1aWxkcyBEb2NrZXIgaW1hZ2VzIGZvciBBZ2VudCBSdW50aW1lc1xuY29uc3QgaW1hZ2VTdGFjayA9IG5ldyBJbWFnZVN0YWNrKGFwcCwgJ0Zpbk9wc0ltYWdlU3RhY2snLCB7XG4gIGVudixcbiAgZGVzY3JpcHRpb246ICdGaW5PcHMgQWdlbnQgLSBEb2NrZXIgSW1hZ2UgQnVpbGQgKEVDUiArIENvZGVCdWlsZCknLFxufSk7XG5cbi8vIFN0YWNrIDI6IEF1dGggU3RhY2sgLSBDb2duaXRvICsgTTJNICsgT0F1dGggUHJvdmlkZXIgKEN1c3RvbSBSZXNvdXJjZSlcbmNvbnN0IGF1dGhTdGFjayA9IG5ldyBBdXRoU3RhY2soYXBwLCAnRmluT3BzQXV0aFN0YWNrJywge1xuICBlbnYsXG4gIGRlc2NyaXB0aW9uOiAnRmluT3BzIEFnZW50IC0gQ29nbml0byBBdXRoZW50aWNhdGlvbiArIE9BdXRoIFByb3ZpZGVyJyxcbiAgYWRtaW5FbWFpbDogYWRtaW5FbWFpbCxcbn0pO1xuXG4vLyBTdGFjayAzOiBNQ1AgUnVudGltZSBTdGFjayAtIERlcGxveSAyIE1DUCBSdW50aW1lcyB3aXRoIEpXVCBhdXRoXG5jb25zdCBtY3BSdW50aW1lU3RhY2sgPSBuZXcgTUNQUnVudGltZVN0YWNrKGFwcCwgJ0Zpbk9wc01DUFJ1bnRpbWVTdGFjaycsIHtcbiAgZW52LFxuICBkZXNjcmlwdGlvbjogJ0Zpbk9wcyBBZ2VudCAtIE1DUCBTZXJ2ZXIgUnVudGltZXMgKEJpbGxpbmcgKyBQcmljaW5nICsgRGF0YSBQcm9jZXNzaW5nKSB3aXRoIEpXVCBBdXRob3JpemF0aW9uJyxcbiAgYmlsbGluZ01jcFJlcG9zaXRvcnk6IGltYWdlU3RhY2suYmlsbGluZ01jcFJlcG9zaXRvcnksXG4gIHByaWNpbmdNY3BSZXBvc2l0b3J5OiBpbWFnZVN0YWNrLnByaWNpbmdNY3BSZXBvc2l0b3J5LFxuICBkYXRhUHJvY2Vzc2luZ01jcFJlcG9zaXRvcnk6IGltYWdlU3RhY2suZGF0YVByb2Nlc3NpbmdNY3BSZXBvc2l0b3J5LFxuICB1c2VyUG9vbElkOiBhdXRoU3RhY2sudXNlclBvb2xJZCxcbiAgbTJtQ2xpZW50SWQ6IGF1dGhTdGFjay5vYXV0aENsaWVudElkLFxuICBhdGhlbmFEYXRhYmFzZSxcbiAgYXRoZW5hVGFibGUsXG4gIGF0aGVuYU91dHB1dEJ1Y2tldCxcbiAgY3VyUzNCdWNrZXQsXG4gIGN1clMzUHJlZml4LFxufSk7XG5tY3BSdW50aW1lU3RhY2suYWRkRGVwZW5kZW5jeShpbWFnZVN0YWNrKTtcbm1jcFJ1bnRpbWVTdGFjay5hZGREZXBlbmRlbmN5KGF1dGhTdGFjayk7XG5cbi8vIFN0YWNrIDQ6IEFnZW50Q29yZSBHYXRld2F5IFN0YWNrIC0gR2F0ZXdheSArIGl0cyBvd24gQ29nbml0byArIE9BdXRoIHByb3ZpZGVyICsgTUNQIHRhcmdldHNcbmNvbnN0IGFnZW50Q29yZUdhdGV3YXlTdGFjayA9IG5ldyBBZ2VudENvcmVHYXRld2F5U3RhY2soYXBwLCAnRmluT3BzQWdlbnRDb3JlR2F0ZXdheVN0YWNrJywge1xuICBlbnYsXG4gIGRlc2NyaXB0aW9uOiAnRmluT3BzIEFnZW50IC0gR2F0ZXdheSB3aXRoIE1DUCBTZXJ2ZXIgVGFyZ2V0cycsXG4gIGJpbGxpbmdNY3BSdW50aW1lQXJuOiBtY3BSdW50aW1lU3RhY2suYmlsbGluZ01jcFJ1bnRpbWVBcm4sXG4gIHByaWNpbmdNY3BSdW50aW1lQXJuOiBtY3BSdW50aW1lU3RhY2sucHJpY2luZ01jcFJ1bnRpbWVBcm4sXG4gIGJpbGxpbmdNY3BSdW50aW1lRW5kcG9pbnQ6IG1jcFJ1bnRpbWVTdGFjay5iaWxsaW5nTWNwUnVudGltZUVuZHBvaW50LFxuICBwcmljaW5nTWNwUnVudGltZUVuZHBvaW50OiBtY3BSdW50aW1lU3RhY2sucHJpY2luZ01jcFJ1bnRpbWVFbmRwb2ludCxcbiAgZGF0YVByb2Nlc3NpbmdNY3BSdW50aW1lQXJuOiBtY3BSdW50aW1lU3RhY2suZGF0YVByb2Nlc3NpbmdNY3BSdW50aW1lQXJuLFxuICBkYXRhUHJvY2Vzc2luZ01jcFJ1bnRpbWVFbmRwb2ludDogbWNwUnVudGltZVN0YWNrLmRhdGFQcm9jZXNzaW5nTWNwUnVudGltZUVuZHBvaW50LFxuICAvLyBBdXRoU3RhY2sgQ29nbml0byBmb3Igb3V0Ym91bmQgT0F1dGggdG8gcnVudGltZXNcbiAgYXV0aFVzZXJQb29sSWQ6IGF1dGhTdGFjay51c2VyUG9vbElkLFxuICBhdXRoVXNlclBvb2xBcm46IGF1dGhTdGFjay51c2VyUG9vbEFybixcbiAgYXV0aE0ybUNsaWVudElkOiBhdXRoU3RhY2sub2F1dGhDbGllbnRJZCxcbn0pO1xuYWdlbnRDb3JlR2F0ZXdheVN0YWNrLmFkZERlcGVuZGVuY3kobWNwUnVudGltZVN0YWNrKTtcbmFnZW50Q29yZUdhdGV3YXlTdGFjay5hZGREZXBlbmRlbmN5KGF1dGhTdGFjayk7XG5cbi8vIFN0YWNrIDU6IE1haW4gUnVudGltZSBTdGFjayAtIE1haW4gYWdlbnQgcnVudGltZSB3aXRoIEdhdGV3YXkgQVJOXG5jb25zdCBhZ2VudFJ1bnRpbWVTdGFjayA9IG5ldyBBZ2VudFJ1bnRpbWVTdGFjayhhcHAsICdGaW5PcHNBZ2VudFJ1bnRpbWVTdGFjaycsIHtcbiAgZW52LFxuICBkZXNjcmlwdGlvbjogJ0Zpbk9wcyBBZ2VudCAtIE1haW4gQWdlbnQgUnVudGltZSB3aXRoIEdhdGV3YXkgSW50ZWdyYXRpb24nLFxuICByZXBvc2l0b3J5OiBpbWFnZVN0YWNrLnJlcG9zaXRvcnksXG4gIHVzZXJQb29sQXJuOiBhdXRoU3RhY2sudXNlclBvb2xBcm4sXG4gIGdhdGV3YXlBcm46IGFnZW50Q29yZUdhdGV3YXlTdGFjay5nYXRld2F5QXJuLFxuICB1c2VyUG9vbElkOiBhdXRoU3RhY2sudXNlclBvb2xJZCxcbiAgdXNlclBvb2xDbGllbnRJZDogYXV0aFN0YWNrLnVzZXJQb29sQ2xpZW50SWQsXG4gIGlkZW50aXR5UG9vbElkOiBhdXRoU3RhY2suaWRlbnRpdHlQb29sSWQsXG59KTtcbmFnZW50UnVudGltZVN0YWNrLmFkZERlcGVuZGVuY3koaW1hZ2VTdGFjayk7XG5hZ2VudFJ1bnRpbWVTdGFjay5hZGREZXBlbmRlbmN5KGF1dGhTdGFjayk7XG5hZ2VudFJ1bnRpbWVTdGFjay5hZGREZXBlbmRlbmN5KGFnZW50Q29yZUdhdGV3YXlTdGFjayk7XG5cbi8vIEFkZCB0YWdzIHRvIGFsbCBzdGFja3NcbmNkay5UYWdzLm9mKGFwcCkuYWRkKCdQcm9qZWN0JywgJ0Zpbk9wc0FnZW50Jyk7XG5jZGsuVGFncy5vZihhcHApLmFkZCgnTWFuYWdlZEJ5JywgJ0NESycpO1xuIl19