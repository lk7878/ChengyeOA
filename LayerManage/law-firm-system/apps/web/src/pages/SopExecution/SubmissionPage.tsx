import Modal from '@/components/DraggableModal';
import { downloadBlob } from "@/api/approval-materials";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Select,
  Space,
  Spin,
  Tag,
  message,
} from "antd";
import { get, post } from "@/features/workspaces/api";
import { showRequestError } from "@/api/errors";
import { useLiveSop, type SopTask } from "@/features/sop/execution";
type Submission = {
  id: string;
  taskId: string;
  number: number;
  report: string;
  contentHash: string;
  createdAt: string;
  materialsVisible: boolean;
  materials: {
    name: string;
    code: string;
    fileId: string;
    fileName: string;
    sha256: string;
  }[];
  review: null | {
    id: string;
    status: string;
    version: number;
    checklist: {
      code: string;
      label?: string;
      result: string;
      reason: string;
    }[];
    approvalId: string | null;
    reviewerIsMe: boolean;
    canAssign: boolean;
    businessSync: null | { status: string; reason: string | null };
  };
};
const states: Record<string, string> = {
  WAITING_ASSIGNMENT: "待分派审核",
  PENDING: "待审核",
  APPROVED: "审核通过",
  RETURNED: "已退回",
  CANCELLED: "已撤回",
};
export function SopDeliverables({
  task,
  refresh,
}: {
  task: SopTask;
  refresh: () => void;
}) {
  const {
    data,
    error,
    refresh: refreshHistory,
  } = useLiveSop<Submission[]>("/sop/tasks/" + task.id + "/submissions");
  const [form] = Form.useForm(),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [key, setKey] = useState(""),
    [version, setVersion] = useState(0),
    [conflict, setConflict] = useState(false);
  const [files, setFiles] = useState<{ id: string; fileName: string }[]>([]),
    [filePage, setFilePage] = useState(1),
    [fileTotal, setFileTotal] = useState(0),
    [fileError, setFileError] = useState("");
  const [reviewers, setReviewers] = useState<{ id: string; name: string }[]>(
    [],
  );
  useEffect(() => {
    let live = true;
    void get<{ id: string; name: string }[]>(
      "/sop/tasks/" + task.id + "/review-options",
    )
      .then((rows) => {
        if (live) setReviewers(rows);
      })
      .catch(() => {
        if (live) setReviewers([]);
      });
    return () => {
      live = false;
    };
  }, [task.id, task.version]);
  async function loadFiles(page: number) {
    try {
      const result = await get<{
        list: { id: string; fileName: string }[];
        total: number;
      }>("/sop/tasks/" + task.id + "/material-options?page=" + page);
      setFiles((old) => (page === 1 ? result.list : [...old, ...result.list]));
      setFileTotal(result.total);
      setFilePage(page);
      setFileError("");
    } catch {
      setFiles([]);
      setFileError("当前没有材料读取权限或材料暂不可用；请核实原业务来源和材料授权。");
    }
  }
  function begin() {
    form.resetFields();
    setKey(crypto.randomUUID());
    setVersion(task.version);
    setConflict(false);
    setOpen(true);
    void loadFiles(1);
  }
  async function submit() {
    try {
      const values = await form.validateFields();
      setBusy(true);
      const materials = task.node.materials.flatMap((m) =>
        ((values["material_" + m.code] ?? []) as string[]).map((fileId) => ({
          code: m.code,
          fileId,
        })),
      );
      await post("/sop/tasks/" + task.id + "/submissions", {
        expectedVersion: version,
        requestKey: key,
        report: values.report,
        materials,
        reviewerUserId: values.reviewerUserId ?? null,
      });
      setOpen(false);
      refresh();
      refreshHistory();
      message.success("成果版本已提交");
    } catch (e) {
      if ((e as { response?: { status?: number } }).response?.status === 409)
        setConflict(true);
      showRequestError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card title="报告与提交版本" style={{ marginTop: 16 }}>
      {error && <Alert type="error" title={error} />}
      {task.permissions.includes("sop.report.submit") &&
        task.status === "IN_PROGRESS" &&
        task.instanceStatus === "ACTIVE" && (
          <Button type="primary" onClick={begin}>
            提交节点成果
          </Button>
        )}
      {data?.length === 0 && <p>暂无提交。每次提交保留独立版本及材料摘要。</p>}
      {data?.map((sub) => (
        <p key={sub.id}>
          <Link to={"/sop/submissions/" + sub.id}>修订 {sub.number}</Link>
          <Tag>{sub.review ? states[sub.review.status] : "已完成"}</Tag>{" "}
          {new Date(sub.createdAt).toLocaleString()}
        </p>
      ))}
      <Modal
        title="提交节点成果"
        okText="提交成果"
        okButtonProps={{ "aria-label": "提交成果", disabled: busy }}
        cancelText="取消"
        open={open}
        forceRender
        onCancel={() => !busy && setOpen(false)}
        onOk={() => void submit()}
        confirmLoading={busy}
        width={720}
      >
        {conflict && (
          <Alert
            type="warning"
            title="任务已变化，输入已保留。请核对最新任务后重试。"
            action={
              <Button
                onClick={() =>
                  void get<SopTask>("/sop/tasks/" + task.id)
                    .then((current) => {
                      setVersion(current.version);
                      setKey(crypto.randomUUID());
                      setConflict(false);
                      refresh();
                    })
                    .catch(showRequestError)
                }
              >
                采用最新任务版本
              </Button>
            }
          />
        )}
        <Form form={form} layout="vertical">
          <Form.Item
            name="report"
            label="成果报告"
            rules={[{ required: true }]}
          >
            <Input.TextArea rows={7} maxLength={20000} />
          </Form.Item>
          {fileError && <Alert type="warning" title={fileError} />}
          {task.node.materials.map((m) => (
            <Form.Item
              key={m.code}
              name={"material_" + m.code}
              label={m.name + (m.required ? "（必需）" : "（提示性）")}
              rules={[{ required: m.required, message: "请选择该项材料" }]}
            >
              <Select
                mode="multiple"
                options={files.map((f) => ({ value: f.id, label: f.fileName }))}
              />
            </Form.Item>
          ))}
          {files.length < fileTotal && (
            <Button onClick={() => void loadFiles(filePage + 1)}>
              加载更多材料
            </Button>
          )}
          {task.node.reviewRequired && (
            <>
              <Form.Item name="reviewerUserId" label="审核人">
                <Select
                  allowClear
                  placeholder="未选择时进入待分派"
                  options={reviewers.map((r) => ({
                    value: r.id,
                    label: r.name,
                  }))}
                />
              </Form.Item>
              <p>审核人须有独立权限并回避提交人和本轮执行人。</p>
            </>
          )}
        </Form>
      </Modal>
    </Card>
  );
}
export function SopGuidance({ task }: { task: SopTask }) {
  const { data, error, refresh } = useLiveSop<
    { id: string; content: string; createdAt: string }[]
  >("/sop/tasks/" + task.id + "/guidance");
  const [text, setText] = useState(""),
    [key, setKey] = useState(crypto.randomUUID()),
    [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await post("/sop/tasks/" + task.id + "/guidance", {
        content: text,
        requestKey: key,
      });
      setText("");
      setKey(crypto.randomUUID());
      refresh();
    } catch (e) {
      showRequestError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card title="专家指导" style={{ marginTop: 16 }}>
      {error && <Alert type="error" title={error} />}
      <p>指导记录不代表审核通过。</p>
      {data?.map((g) => (
        <p key={g.id} style={{ whiteSpace: "pre-wrap" }}>
          {g.content}
          <br />
          <small>{new Date(g.createdAt).toLocaleString()}</small>
        </p>
      ))}
      {task.permissions.includes("sop.guidance.create") && (
        <>
          <Input.TextArea
            aria-label="指导内容"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={10000}
          />
          <Button
            disabled={!text.trim()}
            loading={busy}
            onClick={() => void save()}
          >
            保存指导
          </Button>
        </>
      )}
    </Card>
  );
}
export default function SopSubmissionPage() {
  const { id } = useParams();
  const { data, error, refresh } = useLiveSop<Submission>(
    "/sop/submissions/" + id,
  );
  return (
    <section className="unified-area-page">
      {error && <Alert type="error" title={error} />}{" "}
      {!data && !error && <Spin />}
      {data && (
        <SubmissionContent key={data.id} data={data} refresh={refresh} />
      )}
    </section>
  );
}
function SubmissionContent({
  data,
  refresh,
}: {
  data: Submission;
  refresh: () => void;
}) {
  const [draft, setDraft] = useState<{
      checks: NonNullable<Submission["review"]>["checklist"];
      version: number;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [reviewer, setReviewer] = useState<string>(),
    [options, setOptions] = useState<{ id: string; name: string }[]>([]),
    [requestKey] = useState(crypto.randomUUID());
  const checks = draft?.checks ?? data.review?.checklist ?? [],
    version = draft?.version ?? data.review?.version ?? 0;
  useEffect(() => {
    let live = true;
    if (data.review?.status === "WAITING_ASSIGNMENT")
      void get<typeof options>("/sop/tasks/" + data.taskId + "/review-options")
        .then((rows) => {
          if (live) setOptions(rows);
        })
        .catch(() => {});
    return () => {
      live = false;
    };
  }, [data.taskId, data.review?.status]);
  async function save() {
    if (!data.review) return;
    setBusy(true);
    try {
      await post("/sop/reviews/" + data.review.id + "/checklist", {
        expectedVersion: version,
        checks: checks.map(({ code, result, reason }) => ({
          code,
          result,
          reason,
        })),
      });
      setDraft(null);
      refresh();
      message.success("检查清单已保存，请进入原审批中心作出决定");
    } catch (e) {
      showRequestError(e);
    } finally {
      setBusy(false);
    }
  }
  async function download(fileId: string) {
    try {
      const file = await get<{
        base64: string;
        fileType: string;
        fileName: string;
      }>("/sop/submissions/" + data.id + "/materials/" + fileId);
      const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
      downloadBlob(new Blob([bytes], { type: file.fileType }), file.fileName);
    } catch (error) {
      showRequestError(error);
    }
  }
  async function assign() {
    if (!data.review) return;
    setBusy(true);
    try {
      await post("/sop/reviews/" + data.review.id + "/assign", {
        expectedVersion: data.review.version,
        requestKey,
        reviewerUserId: reviewer,
      });
      refresh();
    } catch (e) {
      showRequestError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Link to={"/sop/tasks/" + data.taskId}>返回SOP任务</Link>
      <h1>成果修订 {data.number}</h1>
      <Tag>{data.review ? states[data.review.status] : "已完成"}</Tag>
      <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
        {data.report}
      </p>
      <details>
        <summary>版本核验信息</summary>
        <p style={{ overflowWrap: "anywhere" }}>{data.contentHash}</p>
      </details>
      <h2>冻结材料</h2>
      {!data.materialsVisible ? (
        <Alert type="info" title="材料需要独立的案件文件读取权限。" />
      ) : data.materials.length ? (
        data.materials.map((m) => (
          <div key={m.code + m.fileId}>
            {m.name} ·{" "}
            <Button type="link" onClick={() => void download(m.fileId)}>
              {m.fileName}
            </Button>
            <details>
              <summary>材料版本核验信息</summary>
              <small style={{ overflowWrap: "anywhere" }}>{m.sha256}</small>
            </details>
          </div>
        ))
      ) : (
        <p>本版本没有附加材料。</p>
      )}
      {data.review && (
        <>
          <h2>一级审核</h2>
          {data.review.businessSync?.status === "FAILED" && (
            <Alert
              type="error"
              title="审批已决定，业务同步未完成"
              description={data.review.businessSync.reason}
            />
          )}
          {checks.map((check, index) => (
            <Card
              key={check.code}
              size="small"
              title={
                check.label ??
                (check.code === "MATERIALS"
                  ? "材料及版本核验"
                  : "成果与风险核验")
              }
              style={{ marginBottom: 8 }}
            >
              <Space orientation="vertical" style={{ width: "100%" }}>
                <Select
                  aria-label={check.code + "检查结果"}
                  disabled={
                    !data.review?.reviewerIsMe ||
                    data.review.status !== "PENDING"
                  }
                  value={check.result}
                  style={{ minWidth: 160 }}
                  options={[
                    { value: "PENDING", label: "待检查", disabled: true },
                    { value: "PASS", label: "通过" },
                    { value: "FAIL", label: "不通过" },
                    { value: "NA", label: "不适用" },
                  ]}
                  onChange={(result) => {
                    setDraft({
                      version,
                      checks: checks.map((c, i) =>
                        i === index ? { ...c, result } : c,
                      ),
                    });
                  }}
                />
                <Input.TextArea
                  aria-label={check.code + "检查依据"}
                  value={check.reason}
                  disabled={
                    !data.review?.reviewerIsMe ||
                    data.review.status !== "PENDING"
                  }
                  placeholder="不通过或不适用时填写依据"
                  onChange={(e) => {
                    setDraft({
                      version,
                      checks: checks.map((c, i) =>
                        i === index ? { ...c, reason: e.target.value } : c,
                      ),
                    });
                  }}
                />
              </Space>
            </Card>
          ))}
          {data.review.reviewerIsMe && data.review.status === "PENDING" && (
            <Button loading={busy} onClick={() => void save()}>
              保存检查清单
            </Button>
          )}
          {data.review.approvalId && (
            <p>
              <Link
                to={"/approvals?role=TODO&instance=" + data.review.approvalId}
              >
                进入原审批中心办理
              </Link>
            </p>
          )}
          {data.review.status === "WAITING_ASSIGNMENT" &&
            data.review.canAssign && (
              <Space wrap>
                <Select
                  aria-label="分派审核人"
                  style={{ minWidth: 180 }}
                  value={reviewer}
                  options={options.map((o) => ({ value: o.id, label: o.name }))}
                  onChange={setReviewer}
                />
                <Button
                  disabled={!reviewer}
                  loading={busy}
                  onClick={() => void assign()}
                >
                  分派审核
                </Button>
              </Space>
            )}
        </>
      )}
    </>
  );
}
