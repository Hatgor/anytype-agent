export const MOCK_AGY_TEXT_STREAM = [
  JSON.stringify({
    event: "init",
    conversation_id: "519b96a7-b386-45e9-a5a9-d3ca4bc47f63",
    init: {
      cwd: "/Users/hatgor/WORK/OSS/anytype-agent",
      tools: ["view_file", "list_dir"],
      permission_mode: "always-proceed",
    },
  }),
  JSON.stringify({
    event: "step_update",
    step_update: {
      conversation_id: "519b96a7-b386-45e9-a5a9-d3ca4bc47f63",
      step_index: 0,
      state: "DONE",
      step_type: "user_input",
    },
  }),
  JSON.stringify({
    event: "step_update",
    step_update: {
      conversation_id: "519b96a7-b386-45e9-a5a9-d3ca4bc47f63",
      step_index: 1,
      state: "ACTIVE",
      step_type: "agent_response",
      text_delta: "Превед, медвед!",
    },
  }),
  JSON.stringify({
    event: "step_update",
    step_update: {
      conversation_id: "519b96a7-b386-45e9-a5a9-d3ca4bc47f63",
      step_index: 1,
      state: "DONE",
      step_type: "agent_response",
      text_delta: " И дратути, анон.",
      duration_seconds: 2.68,
      usage: { input_tokens: 15197, output_tokens: 380 },
    },
  }),
  JSON.stringify({
    event: "result",
    result: {
      conversation_id: "519b96a7-b386-45e9-a5a9-d3ca4bc47f63",
      status: "SUCCESS",
      response: "Превед, медвед! И дратути, анон.",
      duration_seconds: 2.75,
      num_turns: 1,
    },
  }),
].join("\n");

export const MOCK_AGY_TOOL_SUCCESS_STREAM = [
  JSON.stringify({
    event: "init",
    conversation_id: "5c69db1a-3b28-4ee4-96a3-505d7dcdb773",
  }),
  JSON.stringify({
    event: "step_update",
    step_update: {
      conversation_id: "5c69db1a-3b28-4ee4-96a3-505d7dcdb773",
      step_index: 0,
      state: "DONE",
      step_type: "user_input",
    },
  }),
  JSON.stringify({
    event: "step_update",
    step_update: {
      conversation_id: "5c69db1a-3b28-4ee4-96a3-505d7dcdb773",
      step_index: 2,
      state: "ACTIVE",
      step_type: "tool",
      tool_name: "view_file",
      tool_info: {
        name: "view_file",
        parameters: { AbsolutePath: "/Users/hatgor/WORK/OSS/anytype-agent/package.json" },
      },
    },
  }),
  JSON.stringify({
    event: "step_update",
    step_update: {
      conversation_id: "5c69db1a-3b28-4ee4-96a3-505d7dcdb773",
      step_index: 2,
      state: "DONE",
      step_type: "tool",
      tool_name: "view_file",
      duration_seconds: 0.005,
      tool_info: {
        name: "view_file",
        parameters: { AbsolutePath: "/Users/hatgor/WORK/OSS/anytype-agent/package.json" },
        output: "42 lines, 968 bytes",
      },
    },
  }),
  JSON.stringify({
    event: "result",
    result: {
      conversation_id: "5c69db1a-3b28-4ee4-96a3-505d7dcdb773",
      status: "SUCCESS",
      response: "Вот содержимое package.json",
    },
  }),
].join("\n");

export const MOCK_AGY_TOOL_ERROR_STREAM = [
  JSON.stringify({
    event: "step_update",
    step_update: {
      conversation_id: "f68179b6-7518-4e66-a721-cb5ca5d1c338",
      step_index: 2,
      state: "ACTIVE",
      step_type: "tool",
      tool_name: "view_file",
      tool_info: {
        name: "view_file",
        parameters: { AbsolutePath: "/Users/hatgor/WORK/OSS/anytype-agent/non_existent.txt" },
      },
    },
  }),
  JSON.stringify({
    event: "step_update",
    step_update: {
      conversation_id: "f68179b6-7518-4e66-a721-cb5ca5d1c338",
      step_index: 2,
      state: "ERROR",
      step_type: "tool",
      tool_name: "view_file",
      duration_seconds: 0.006,
      tool_info: {
        name: "view_file",
        parameters: { AbsolutePath: "/Users/hatgor/WORK/OSS/anytype-agent/non_existent.txt" },
        error: {
          type: "TOOL_ERROR",
          message: "failed to read file: no such file or directory",
        },
      },
    },
  }),
  JSON.stringify({
    event: "result",
    result: {
      conversation_id: "f68179b6-7518-4e66-a721-cb5ca5d1c338",
      status: "SUCCESS",
      response: "Файла не существует!",
    },
  }),
].join("\n");

export const MOCK_AGY_FAILURE_STREAM = [
  JSON.stringify({
    event: "result",
    result: {
      status: "FAILURE",
      error: "Remote token expired or permission denied",
    },
  }),
].join("\n");

export const MOCK_AGY_REST_REQUEST_STREAM = [
  JSON.stringify({
    event: "init",
    conversation_id: "163fff05-3b79-4dbe-9782-9722d1c65ca1",
  }),
  JSON.stringify({
    event: "step_update",
    step_update: {
      conversation_id: "163fff05-3b79-4dbe-9782-9722d1c65ca1",
      step_index: 0,
      state: "DONE",
      step_type: "user_input",
    },
  }),
  JSON.stringify({
    event: "step_update",
    step_update: {
      conversation_id: "163fff05-3b79-4dbe-9782-9722d1c65ca1",
      step_index: 2,
      state: "ACTIVE",
      step_type: "tool",
      tool_name: "read_url_content",
      tool_info: {
        name: "read_url_content",
        parameters: { Url: "https://httpbin.org/json" },
      },
    },
  }),
  JSON.stringify({
    event: "step_update",
    step_update: {
      conversation_id: "163fff05-3b79-4dbe-9782-9722d1c65ca1",
      step_index: 2,
      state: "DONE",
      step_type: "tool",
      tool_name: "read_url_content",
      duration_seconds: 1.44,
      tool_info: {
        name: "read_url_content",
        parameters: { Url: "https://httpbin.org/json" },
      },
    },
  }),
  JSON.stringify({
    event: "result",
    result: {
      conversation_id: "163fff05-3b79-4dbe-9782-9722d1c65ca1",
      status: "SUCCESS",
      response: "Таки сходил по ссылке через read_url_content",
    },
  }),
].join("\n");

export const MOCK_AGY_POST_CURL_STREAM = [
  JSON.stringify({
    event: "init",
    conversation_id: "bca69b06-0bda-41fd-a12d-50511ef15de6",
  }),
  JSON.stringify({
    event: "step_update",
    step_update: {
      conversation_id: "bca69b06-0bda-41fd-a12d-50511ef15de6",
      step_index: 0,
      state: "DONE",
      step_type: "user_input",
    },
  }),
  JSON.stringify({
    event: "step_update",
    step_update: {
      conversation_id: "bca69b06-0bda-41fd-a12d-50511ef15de6",
      step_index: 2,
      state: "ACTIVE",
      step_type: "tool",
      tool_name: "run_command",
      tool_info: {
        name: "run_command",
        parameters: {
          CommandLine:
            'curl -s -X POST https://httpbin.org/post -H "Content-Type: application/json" -d \'{"hello":"world"}\'',
        },
      },
    },
  }),
  JSON.stringify({
    event: "step_update",
    step_update: {
      conversation_id: "bca69b06-0bda-41fd-a12d-50511ef15de6",
      step_index: 2,
      state: "DONE",
      step_type: "tool",
      tool_name: "run_command",
      duration_seconds: 0.67,
      tool_info: {
        name: "run_command",
        parameters: {
          CommandLine:
            'curl -s -X POST https://httpbin.org/post -H "Content-Type: application/json" -d \'{"hello":"world"}\'',
        },
        output: '{\n  "json": {\n    "hello": "world"\n  }\n}',
      },
    },
  }),
  JSON.stringify({
    event: "result",
    result: {
      conversation_id: "bca69b06-0bda-41fd-a12d-50511ef15de6",
      status: "SUCCESS",
      response: "POST запрос успешно отправлен через curl",
    },
  }),
].join("\n");
