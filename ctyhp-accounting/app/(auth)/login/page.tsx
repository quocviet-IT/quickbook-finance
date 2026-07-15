"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Card, Form, Input, Typography } from "antd";
import { createSupabaseBrowserClient } from "@/lib/db/client";

interface LoginValues {
  email: string;
  password: string;
}

export default function LoginPage() {
  const router = useRouter();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);

  async function onFinish(values: LoginValues) {
    setLoading(true);
    const sb = createSupabaseBrowserClient();
    const { error } = await sb.auth.signInWithPassword({
      email: values.email,
      password: values.password,
    });
    setLoading(false);
    if (error) {
      message.error(error.message);
      return;
    }
    router.refresh();
    router.push("/dashboard");
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f5f5f5",
      }}
    >
      <Card style={{ width: 380 }}>
        <Typography.Title level={3} style={{ textAlign: "center", marginBottom: 4 }}>
          CTYHP Kế toán
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ textAlign: "center" }}>
          Đăng nhập để tiếp tục
        </Typography.Paragraph>
        <Form layout="vertical" onFinish={onFinish} requiredMark={false}>
          <Form.Item
            name="email"
            label="Email"
            rules={[{ required: true, type: "email", message: "Nhập email hợp lệ" }]}
          >
            <Input autoComplete="email" placeholder="you@ctyhp.vn" />
          </Form.Item>
          <Form.Item
            name="password"
            label="Mật khẩu"
            rules={[{ required: true, message: "Nhập mật khẩu" }]}
          >
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading}>
            Đăng nhập
          </Button>
        </Form>
      </Card>
    </div>
  );
}
