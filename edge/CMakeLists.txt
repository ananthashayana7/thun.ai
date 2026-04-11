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

find_package(OpenSSL QUIET)

# ─── Main shared library (loaded by mobile via JNI / BLE bridge) ──────────────
add_library(ivis SHARED ${IVIS_SOURCES})

target_include_directories(ivis PUBLIC
  ${CMAKE_CURRENT_SOURCE_DIR}/src
)
if(OpenSSL_FOUND)
  target_link_libraries(ivis PRIVATE OpenSSL::Crypto)
  target_compile_definitions(ivis PRIVATE IVIS_HAVE_OPENSSL=1)
endif()

# ─── Standalone test binary ───────────────────────────────────────────────────
add_executable(ivis_test src/ivis_engine.cpp ${IVIS_SOURCES})
target_include_directories(ivis_test PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src)
target_compile_definitions(ivis_test PRIVATE IVIS_STANDALONE_TEST=1)
if(OpenSSL_FOUND)
  target_link_libraries(ivis_test PRIVATE OpenSSL::Crypto)
  target_compile_definitions(ivis_test PRIVATE IVIS_HAVE_OPENSSL=1)
endif()

add_executable(ivis_selftest src/ivis_selftest.cpp)
target_include_directories(ivis_selftest PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src)

# ─── Install rules ────────────────────────────────────────────────────────────
install(TARGETS ivis ivis_selftest
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

# ─── Google Test via FetchContent ─────────────────────────────────────────────
include(FetchContent)
FetchContent_Declare(
  googletest
  GIT_REPOSITORY https://github.com/google/googletest.git
  GIT_TAG v1.14.0
)
# Prevent GoogleTest from overriding our compiler/linker settings on Windows
set(gtest_force_shared_crt ON CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(googletest)

enable_testing()

# ── Shared sources (non-main) for test linking ────────────────────────────────
set(IVIS_LIB_SOURCES
  src/obd_parser.cpp
  src/stress_index.cpp
  src/intervention_dispatcher.cpp
)

# ── Test: OBD Parser ─────────────────────────────────────────────────────────
add_executable(test_obd_parser
  test/test_obd_parser.cpp
  ${IVIS_LIB_SOURCES}
)
target_include_directories(test_obd_parser PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src)
target_link_libraries(test_obd_parser PRIVATE GTest::gtest)
add_test(NAME OBDParserTests COMMAND test_obd_parser)

# ── Test: Stress Index ───────────────────────────────────────────────────────
add_executable(test_stress_index
  test/stress_index_test.cpp
  src/stress_index.cpp
)
target_include_directories(test_stress_index PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src)
target_link_libraries(test_stress_index PRIVATE GTest::gtest)
add_test(NAME StressIndexTests COMMAND test_stress_index)

# ── Test: Intervention Dispatcher ────────────────────────────────────────────
add_executable(test_intervention_dispatcher
  test/test_intervention_dispatcher.cpp
  ${IVIS_LIB_SOURCES}
)
target_include_directories(test_intervention_dispatcher PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src)
target_link_libraries(test_intervention_dispatcher PRIVATE GTest::gtest)
add_test(NAME InterventionDispatcherTests COMMAND test_intervention_dispatcher)
