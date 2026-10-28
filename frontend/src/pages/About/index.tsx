/**
 * 关于平台页面 /about
 *
 * 纯静态页面，展示项目信息、开源属性、技术栈和协议。
 */
import { Button, Card, Divider, Tag, Typography } from 'antd';
import { GithubOutlined, HeartFilled } from '@ant-design/icons';
import {
  Info,
  Code2,
  Scale,
  Globe,
  Shield,
  Cpu,
  Layers,
  Palette,
  Database,
  Cloud,
} from 'lucide-react';
import PageShell from '@components/Layout/PageShell';
import SectionHeader from '@components/Layout/SectionHeader';
import { APP_NAME } from '@utils/constants';
import styles from './About.module.css';

const { Paragraph, Text, Link } = Typography;

const GITHUB_URL = 'https://github.com/zetxtech/acme-worker';

const TECH_STACK = [
  { name: 'Cloudflare Worker', icon: <Cloud size={14} />, color: 'orange' },
  { name: 'Cloudflare KV / D1', icon: <Database size={14} />, color: 'gold' },
  { name: 'React 18', icon: <Code2 size={14} />, color: 'blue' },
  { name: 'TypeScript', icon: <Cpu size={14} />, color: 'cyan' },
  { name: 'Ant Design 5', icon: <Palette size={14} />, color: 'geekblue' },
  { name: 'Vite', icon: <Layers size={14} />, color: 'purple' },
  { name: 'ACME Protocol', icon: <Shield size={14} />, color: 'green' },
  { name: 'Hono', icon: <Globe size={14} />, color: 'volcano' },
];

const FEATURES = [
  '支持多家免费 CA（Let\'s Encrypt、ZeroSSL、Google Trust 等）',
  '基于 Cloudflare Worker 的 Serverless 架构，无需服务器',
  '支持 DNS-01 / HTTP-01 域名验证',
  '支持通配符证书和多域名 SAN 证书',
  '支持 RSA / ECC 多种加密算法',
  '提供 RESTful API 接口，方便自动化集成',
  '内置用户管理、配额控制和速率限制',
  '支持亮色 / 暗色主题切换',
];

export default function AboutPage() {
  return (
    <PageShell>
      <div className={styles.container}>
        <SectionHeader
          icon={<Info size={18} />}
          title="关于平台"
          subtitle="项目信息与开源说明"
        />

        {/* 英雄区域 */}
        <div className={styles.hero}>
          <div className={styles.heroIcon}>
            <Shield size={36} color="#fff" />
          </div>
          <h1 className={styles.heroTitle}>{APP_NAME}</h1>
          <p className={styles.heroSub}>
            基于 Cloudflare Worker 的 ACME 证书自动化管理平台，
            提供免费 SSL/TLS 证书的申请、管理与自动续期服务。
          </p>
          <div className={styles.badge}>
            <HeartFilled style={{ color: '#ef4444' }} />
            <span>开源项目 · 免费使用 · 社区驱动</span>
          </div>
        </div>

        {/* 卡片网格 */}
        <div className={styles.grid}>
          {/* 项目信息 */}
          <Card className={styles.infoCard} title={<><Globe size={16} /> 项目信息</>}>
            <Paragraph>
              <Text strong>项目名称：</Text>CFWorkerACME
            </Paragraph>
            <Paragraph>
              <Text strong>项目简介：</Text>
              一个完全运行在 Cloudflare Worker 上的 ACME 证书管理平台，
              无需传统服务器即可实现 SSL/TLS 证书的自动化签发与管理。
            </Paragraph>
            <Paragraph>
              <Text strong>开源地址：</Text>
              <Link href={GITHUB_URL} target="_blank">
                {GITHUB_URL}
              </Link>
            </Paragraph>
            <Button
              type="primary"
              icon={<GithubOutlined />}
              href={GITHUB_URL}
              target="_blank"
              className={styles.linkBtn}
            >
              访问 GitHub 仓库
            </Button>
          </Card>

          {/* 技术栈 */}
          <Card className={styles.infoCard} title={<><Code2 size={16} /> 技术栈</>}>
            <Paragraph>本项目采用现代化的全栈技术方案构建：</Paragraph>
            <div className={styles.techStack}>
              {TECH_STACK.map((tech) => (
                <Tag key={tech.name} icon={tech.icon} color={tech.color}>
                  {tech.name}
                </Tag>
              ))}
            </div>
          </Card>

          {/* 功能特性 */}
          <Card className={styles.infoCard} title={<><Layers size={16} /> 功能特性</>}>
            <ul style={{ paddingLeft: 20, margin: 0 }}>
              {FEATURES.map((f, i) => (
                <li key={i} style={{ marginBottom: 6, color: 'var(--text-2)' }}>
                  {f}
                </li>
              ))}
            </ul>
          </Card>

          {/* 开源协议 */}
          <Card className={styles.infoCard} title={<><Scale size={16} /> 开源协议</>}>
            <Paragraph>
              本项目基于 <Text strong>GNU GPL v3</Text> 开源协议发布，完整条款以仓库 LICENSE 文件为准。
            </Paragraph>
            <Paragraph>
              您可以自由地使用、修改和分发本项目的代码，但需保留原始版权声明。
            </Paragraph>
            <Paragraph type="secondary">
              分发项目或修改版本时，请遵守许可证关于版权声明、许可证副本和对应源码的要求。
            </Paragraph>
            <Divider style={{ margin: '12px 0' }} />
            <Paragraph>
              <Text strong>贡献代码：</Text>
              欢迎通过 GitHub 提交 Issue 和 Pull Request 参与项目开发。
            </Paragraph>
          </Card>
        </div>

        {/* 底部 */}
        <div className={styles.footer}>
          Made with <HeartFilled style={{ color: '#ef4444', margin: '0 4px' }} /> by{' '}
          <Link href={GITHUB_URL} target="_blank">zetxtech</Link>
          {' '}& Open Source Community
        </div>
      </div>
    </PageShell>
  );
}
