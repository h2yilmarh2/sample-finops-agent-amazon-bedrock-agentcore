#!/bin/bash
set -euo pipefail

echo "=== Transformation Script: Clone and Transform Data Processing MCP Server ==="

# Clone upstream repository
echo "Cloning upstream MCP repository..."
git clone --depth 1 https://github.com/awslabs/mcp.git
cd mcp/src/aws-dataprocessing-mcp-server

SERVER_FILE="awslabs/aws_dataprocessing_mcp_server/server.py"

# Transform server.py
echo "Transforming server.py..."

python3 -c "
import re

with open('$SERVER_FILE', 'r') as f:
    content = f.read()

# 1. Patch imports if using mcp SDK instead of fastmcp package
if 'from mcp.server.fastmcp import' in content:
    content = re.sub(r'from mcp\.server\.fastmcp import.*', 'from fastmcp import FastMCP, Context', content)
    print('Import patched: mcp.server.fastmcp -> fastmcp')
elif 'from fastmcp import' in content:
    print('Already using fastmcp package import')
else:
    print('WARNING: Unexpected import pattern, proceeding...')

# 2. Remove 'dependencies' kwarg from FastMCP constructor if present
content = re.sub(r'\s*dependencies=\[.*?\],?\n?', '\n', content, flags=re.DOTALL)
content = re.sub(r'\s*dependencies=[A-Za-z_][A-Za-z_0-9]*,?\n?', '\n', content)
print('Removed dependencies kwarg if present')

# 3. Replace main() function
# Try common patterns
patterns = [
    ('''def main():
    \"\"\"Main entry point for the server.\"\"\"
    # Run the setup function to initialize the server
    asyncio.run(setup())

    # Start the MCP server
    mcp.run()''', True),
    ('''def main():
    \"\"\"Run the MCP server with CLI argument support.\"\"\"
    mcp.run()''', True),
    ('''def main():
    \"\"\"Main entry point for the server.\"\"\"
    mcp.run()''', True),
]

new_main = '''def main():
    \"\"\"Run the MCP server with streamable-http transport.\"\"\"
    global mcp

    # Read-only mode: only enable handlers needed for CUR queries
    allow_write = False
    allow_sensitive_data_access = True

    # Create the MCP server instance
    mcp = create_server()

    # Initialize only Athena and Glue Data Catalog handlers (CUR queries)
    AthenaQueryHandler(mcp, allow_write=allow_write, allow_sensitive_data_access=allow_sensitive_data_access)
    AthenaDataCatalogHandler(mcp, allow_write=allow_write, allow_sensitive_data_access=allow_sensitive_data_access)
    AthenaWorkGroupHandler(mcp, allow_write=allow_write, allow_sensitive_data_access=allow_sensitive_data_access)
    GlueDataCatalogHandler(mcp, allow_write=allow_write, allow_sensitive_data_access=allow_sensitive_data_access)

    # Run with streamable-http transport
    mcp.run(transport='streamable-http', host='0.0.0.0', port=8000, stateless_http=True)'''

patched = False
for old_main, _ in patterns:
    if old_main in content:
        content = content.replace(old_main, new_main)
        print('main() function patched')
        patched = True
        break

if not patched:
    # Fallback: regex replace the entire main() function (from def to return or end)
    content = re.sub(
        r'def main\(\):.*?mcp\.run\(\).*?(?=\nif __name__|$)',
        new_main + '\n',
        content,
        flags=re.DOTALL
    )
    if 'streamable-http' in content:
        print('main() function patched via regex fallback')
    else:
        print('ERROR: Could not patch main() function')
        exit(1)

with open('$SERVER_FILE', 'w') as f:
    f.write(content)

print('server.py transformation complete')
"

# Validate transformation
grep -q 'streamable-http' "$SERVER_FILE" || { echo "ERROR: streamable-http not found in server.py"; exit 1; }
grep -q 'port=8000' "$SERVER_FILE" || { echo "ERROR: port=8000 not found in server.py"; exit 1; }
echo "server.py transformation verified."

# Patch Context import in ALL files to use fastmcp.Context (which is excluded from schema)
# The upstream server imports from 'mcp.server.fastmcp' which doesn't auto-exclude ctx
echo "Patching Context imports to use fastmcp package..."
find . -name "*.py" -exec python3 -c "
import sys, re

filepath = sys.argv[1]
with open(filepath, 'r') as f:
    content = f.read()

original = content

# Replace 'from mcp.server.fastmcp import Context' with 'from fastmcp import Context'
content = re.sub(
    r'from mcp\.server\.fastmcp import Context',
    'from fastmcp import Context',
    content
)
# Also handle 'from mcp.server.fastmcp import FastMCP, Context' etc
content = re.sub(
    r'from mcp\.server\.fastmcp import (.+)',
    lambda m: 'from fastmcp import ' + m.group(1),
    content
)

if content != original:
    with open(filepath, 'w') as f:
        f.write(content)
    print(f'  Patched imports: {filepath}')
" {} \;
echo "Context import patching complete."

# Add fastmcp dependency if needed
if grep -q 'fastmcp' pyproject.toml; then
    echo "fastmcp already in pyproject.toml"
else
    echo "Adding fastmcp dependency..."
    python3 -c "
import re
with open('pyproject.toml', 'r') as f:
    content = f.read()
content = re.sub(
    r'(dependencies\s*=\s*\[)',
    r'\1\n    \"fastmcp>=3.0.0\",',
    content,
    count=1
)
with open('pyproject.toml', 'w') as f:
    f.write(content)
print('fastmcp dependency added to pyproject.toml')
"
fi

# Regenerate lockfile
echo "Regenerating uv.lock..."
pip3 install uv --quiet 2>/dev/null || python3 -m pip install uv --quiet
uv lock --python 3.13
echo "Lockfile regenerated."

# Disable UV_FROZEN in Dockerfile
echo "Disabling UV_FROZEN and --frozen in Dockerfile..."
sed -i 's/UV_FROZEN=1/UV_FROZEN=0/g' Dockerfile
sed -i '/ENV UV_FROZEN/d' Dockerfile
sed -i 's/ --frozen//g' Dockerfile
echo "UV_FROZEN handling complete."

# Transform Dockerfile: add EXPOSE and update entrypoint
echo "Transforming Dockerfile..."
grep -q 'EXPOSE 8000' Dockerfile || sed -i '/^HEALTHCHECK/i EXPOSE 8000' Dockerfile
sed -i 's|ENTRYPOINT.*|ENTRYPOINT ["python", "-m", "awslabs.aws_dataprocessing_mcp_server.server"]|' Dockerfile
grep -q 'EXPOSE 8000' Dockerfile || { echo "ERROR: EXPOSE 8000 not in Dockerfile"; exit 1; }
echo "Dockerfile transformation verified."

# Transform healthcheck
echo "Transforming docker-healthcheck.sh..."
cat > docker-healthcheck.sh << 'HEALTHCHECK_EOF'
#!/bin/bash
curl -sf http://localhost:8000/mcp || exit 1
HEALTHCHECK_EOF
chmod +x docker-healthcheck.sh
echo "Healthcheck transformation verified."

echo "=== All Data Processing MCP server transformations complete ==="
