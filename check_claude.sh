#!/bin/bash 
# 完整版本：[https://gist.github.com/](https://gist.github.com/)[yourname]/mcp-debugger 

echo  "=== Node.js Detective ===" 

echo  "--- which node (终端路径) ---" 
which node 
node -v 

echo  "--- /usr/bin/node (系统默认) ---"
 /usr/bin/node -v 

echo  "--- Global npm modules path ---"
 npm list -g --depth=0 2>/dev/null | grep modelcontextprotocol 
# 查找包名称旁边的路径