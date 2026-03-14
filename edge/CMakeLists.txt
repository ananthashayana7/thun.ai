cmake_minimum_required(VERSION 3.16)
project(ivis_engine VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# ─── Compiler flags ───────────────────────────────────────────────────────────
set(COMMON_FLAGS "-Wall -Wextra -Wpedantic -fstack-protector-strong")
set(CMAKE_CXX_FLAGS_RELEASE "${COMMON_FLAGS} -O2 -DNDEBUG")
set(CMAKE_CXX_FLAGS_DEBUG   "${COMMON_FLAGS} -g -fsanitize=address,undefined")

# ─── Target platform: Rockchip RV1126 (ARM Cortex-A7) ────────────────────────
if(DEFINED CMAKE_TOOLCHAIN_FILE)
  message(STATUS "Cross-compiling with toolchain: ${CMAKE_TOOLCHAIN_FILE}")
endif()

# ─── Source files ─────────────────────────────────────────────────────────────
set(IVIS_SOURCES
  src/ivis_engine.cpp
  src/obd_parser.cpp
  src/stress_index.cpp
  src/intervention_dispatcher.cpp
)

# ─── Main shared library (loaded by mobile via JNI / BLE bridge) ──────────────
add_library(ivis SHARED ${IVIS_SOURCES})

target_include_directories(ivis PUBLIC
  ${CMAKE_CURRENT_SOURCE_DIR}/src
)

# ─── Standalone test binary ───────────────────────────────────────────────────
add_executable(ivis_test src/ivis_engine.cpp ${IVIS_SOURCES})
target_include_directories(ivis_test PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src)
target_compile_definitions(ivis_test PRIVATE IVIS_STANDALONE_TEST=1)

# ─── Install rules ────────────────────────────────────────────────────────────
install(TARGETS ivis
  LIBRARY DESTINATION lib
  RUNTIME DESTINATION bin
)
install(FILES
  src/ivis_engine.h
  src/obd_parser.h
  src/stress_index.h
  src/intervention_dispatcher.h
  DESTINATION include/ivis
)
