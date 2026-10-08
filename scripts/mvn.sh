#!/usr/bin/env bash
#
# FJTravel · 在 Git Bash 下可靠启动 Maven
#
# 背景：本机 `mvn` 的 shell 启动器不做 POSIX -> Windows 路径转换，
#       会把 /d/... 形式的路径直接交给 Windows 版 java.exe，导致
#       java.lang.ClassNotFoundException:
#           org.codehaus.plexus.classworlds.launcher.Launcher
#       本脚本在调用 java 前用 cygpath -w 显式转换，规避该问题。
#
# 用法：
#   scripts/mvn.sh -v
#   scripts/mvn.sh clean package -DskipTests
#
# 覆盖安装位置（可选）：
#   MAVEN_HOME=/path/to/maven scripts/mvn.sh -v

set -euo pipefail

resolve_maven_home() {
  if [ -n "${MAVEN_HOME:-}" ] && [ -d "${MAVEN_HOME}" ]; then
    (cd "${MAVEN_HOME}" && pwd)
    return
  fi
  local shim
  shim="$(command -v mvn 2>/dev/null || true)"
  if [ -n "${shim}" ]; then
    (cd "$(dirname "${shim}")/.." && pwd)
    return
  fi
  echo "D:/development/apache-maven-3.9.10"
}

resolve_java() {
  if [ -n "${JAVA_HOME:-}" ] && [ -x "${JAVA_HOME}/bin/java" ]; then
    echo "${JAVA_HOME}/bin/java"
    return
  fi
  command -v java
}

MAVEN_HOME_DIR="$(resolve_maven_home)"
CW_JAR="$(ls "${MAVEN_HOME_DIR}"/boot/plexus-classworlds-*.jar 2>/dev/null | head -1)"

if [ -z "${CW_JAR}" ]; then
  echo "[mvn.sh] 找不到 plexus-classworlds jar，请检查 ${MAVEN_HOME_DIR}/boot" >&2
  exit 1
fi

JAVA_BIN="$(resolve_java)"
if [ -z "${JAVA_BIN}" ]; then
  echo "[mvn.sh] 找不到 java，请检查 PATH 或 JAVA_HOME" >&2
  exit 1
fi

exec "${JAVA_BIN}" \
  -classpath "$(cygpath -w "${CW_JAR}")" \
  -Dclassworlds.conf="$(cygpath -w "${MAVEN_HOME_DIR}/bin/m2.conf")" \
  -Dmaven.home="$(cygpath -w "${MAVEN_HOME_DIR}")" \
  -Dmaven.multiModuleProjectDirectory="$(cygpath -w "${PWD}")" \
  org.codehaus.plexus.classworlds.launcher.Launcher "$@"
