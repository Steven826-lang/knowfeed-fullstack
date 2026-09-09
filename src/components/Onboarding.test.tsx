import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Onboarding } from "./Onboarding";

describe("Onboarding", () => {
  it("keeps form input and retries from the error state", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(
      <Onboarding
        isBuilding={false}
        activeStage="planner"
        statusText="生成中断，表单已保留，可以直接重试"
        errorText="LLM provider rejected the request"
        onComplete={onComplete}
      />
    );

    await user.type(screen.getByLabelText("想学的主题或问题"), "摄影构图判断");
    await user.type(screen.getByLabelText("你的背景"), "我是刚开始拍照的学习者。");
    await user.type(screen.getByLabelText("不想看到的风格"), "器材党口吻");
    await user.type(screen.getByLabelText("这次想达成什么"), "能看懂别人点评照片。");
    await user.click(screen.getByRole("button", { name: "保留表单并重试" }));

    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        topicTitle: "摄影构图判断",
        background: "我是刚开始拍照的学习者。",
        avoidedStyles: "器材党口吻",
        goal: "能看懂别人点评照片。"
      })
    );
    expect(screen.getByDisplayValue("摄影构图判断")).toBeInTheDocument();
    expect(screen.getByDisplayValue("我是刚开始拍照的学习者。")).toBeInTheDocument();
    expect(screen.getByDisplayValue("器材党口吻")).toBeInTheDocument();
    expect(screen.getByDisplayValue("能看懂别人点评照片。")).toBeInTheDocument();
  });
});
