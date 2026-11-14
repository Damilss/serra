# The classifier as a CMake library: include() this after pico_sdk_init(), then link
# `serra_classifier`. The project must enable CXX (TensorFlow Lite Micro is C++).
#
#   include(${CMAKE_CURRENT_LIST_DIR}/classifier/classifier.cmake)
#   target_link_libraries(node serra_classifier)
#
# TensorFlow Lite Micro comes from a pico-tflmicro checkout
# (https://github.com/raspberrypi/pico-tflmicro, tested at commit dfea53b). Point
# PICO_TFLMICRO_PATH at it, as an environment variable or with -D; the default is a
# `pico-tflmicro` folder next to the Pico SDK.

set(SERRA_CLASSIFIER_DIR ${CMAKE_CURRENT_LIST_DIR})

if (NOT PICO_TFLMICRO_PATH)
	if (DEFINED ENV{PICO_TFLMICRO_PATH})
		set(PICO_TFLMICRO_PATH $ENV{PICO_TFLMICRO_PATH})
	else()
		get_filename_component(PICO_TFLMICRO_PATH "${PICO_SDK_PATH}/../pico-tflmicro" ABSOLUTE)
	endif()
endif()
set(PICO_TFLMICRO_PATH "${PICO_TFLMICRO_PATH}" CACHE PATH "pico-tflmicro checkout")
if (NOT EXISTS ${PICO_TFLMICRO_PATH}/src/tensorflow/lite/micro/micro_interpreter.h)
	message(FATAL_ERROR
		"pico-tflmicro not found at ${PICO_TFLMICRO_PATH}. Clone "
		"https://github.com/raspberrypi/pico-tflmicro and set PICO_TFLMICRO_PATH.")
endif()

# ---- TensorFlow Lite Micro with the CMSIS-NN kernels ----
# pico-tflmicro's own CMakeLists is a top-level project (it imports the SDK itself), so it
# can't be add_subdirectory()'d. This builds the same sources, minus its audio "signal"
# ops and its copy of KISS FFT, which we don't use and vendor ourselves below.
set(TFLM_SRC ${PICO_TFLMICRO_PATH}/src)
file(GLOB_RECURSE TFLM_SOURCES
	${TFLM_SRC}/tensorflow/*.c
	${TFLM_SRC}/tensorflow/*.cc
	${TFLM_SRC}/tensorflow/*.cpp
	${TFLM_SRC}/third_party/cmsis_nn/Source/*.c
)
list(FILTER TFLM_SOURCES EXCLUDE REGEX "_test\\.cpp$")

add_library(serra_tflm STATIC ${TFLM_SOURCES})
target_include_directories(serra_tflm PUBLIC
	${TFLM_SRC}
	${TFLM_SRC}/third_party/ruy
	${TFLM_SRC}/third_party/gemmlowp
	${TFLM_SRC}/third_party/flatbuffers/include
	${TFLM_SRC}/third_party/cmsis/CMSIS/Core/Include
	${TFLM_SRC}/third_party/cmsis_nn/Include
)
target_compile_definitions(serra_tflm PUBLIC
	TF_LITE_STATIC_MEMORY=1
	TF_LITE_DISABLE_X86_NEON=1
	CMSIS_NN=1
	ARDUINO=1  # pico-tflmicro's own build sets this: it selects the microcontroller code paths
)
target_compile_options(serra_tflm PRIVATE -w)
target_compile_options(serra_tflm PUBLIC
	# With ARDUINO set, flatbuffers skips <cstdint> and newer GCCs no longer pull it in.
	"$<$<COMPILE_LANGUAGE:CXX>:SHELL:-include cstdint>"
	$<$<COMPILE_LANGUAGE:CXX>:-fno-rtti>
	$<$<COMPILE_LANGUAGE:CXX>:-fno-exceptions>
	$<$<COMPILE_LANGUAGE:CXX>:-fno-threadsafe-statics>
)
target_link_libraries(serra_tflm PUBLIC pico_stdlib)

# ---- Features + model + wrapper ----
set(MICROFRONTEND_DIR ${SERRA_CLASSIFIER_DIR}/third_party/microfrontend)
set(MICROFRONTEND_LIB ${MICROFRONTEND_DIR}/tensorflow/lite/experimental/microfrontend/lib)
set(KISSFFT_DIR ${SERRA_CLASSIFIER_DIR}/third_party/kissfft)
file(GLOB MICROFRONTEND_SOURCES ${MICROFRONTEND_LIB}/*.c ${MICROFRONTEND_LIB}/*.cc)
set(KISSFFT_SOURCES ${KISSFFT_DIR}/kiss_fft.c ${KISSFFT_DIR}/tools/kiss_fftr.c)
# KISS FFT's headers have no extern "C" guards and the microfrontend calls it from C++, so
# it is built as C++, as model/features.py does for the PC.
set_source_files_properties(${KISSFFT_SOURCES} PROPERTIES LANGUAGE CXX)

add_library(serra_classifier STATIC
	${SERRA_CLASSIFIER_DIR}/classifier.cc
	${SERRA_CLASSIFIER_DIR}/features.c
	${SERRA_CLASSIFIER_DIR}/model_data.cc
	${MICROFRONTEND_SOURCES}
	${KISSFFT_SOURCES}
)
target_include_directories(serra_classifier PUBLIC ${SERRA_CLASSIFIER_DIR})
# The vendored microfrontend comes first so its headers win over any copy in pico-tflmicro.
target_include_directories(serra_classifier BEFORE PRIVATE
	${MICROFRONTEND_DIR}
	${KISSFFT_DIR}
	${KISSFFT_DIR}/tools
)
target_compile_definitions(serra_classifier PRIVATE FIXED_POINT=16)
target_link_libraries(serra_classifier PRIVATE serra_tflm pico_stdlib)
