import { User, WritingTask, AIMessage } from './types'

// 模拟用户数据
export const mockUsers: User[] = [
  {
    id: 'user-1',
    name: '张三',
    email: 'zhangsan@example.com',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=zhangsan',
    role: 'user',
    status: 'active',
    createdAt: '2024-01-15T08:00:00Z',
    taskCount: 12,
  },
  {
    id: 'user-2',
    name: '李四',
    email: 'lisi@example.com',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=lisi',
    role: 'user',
    status: 'active',
    createdAt: '2024-02-20T10:30:00Z',
    taskCount: 8,
  },
  {
    id: 'user-3',
    name: '王五',
    email: 'wangwu@example.com',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=wangwu',
    role: 'user',
    status: 'disabled',
    createdAt: '2024-03-10T14:15:00Z',
    taskCount: 3,
  },
  {
    id: 'user-4',
    name: '赵六',
    email: 'zhaoliu@example.com',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=zhaoliu',
    role: 'user',
    status: 'active',
    createdAt: '2024-04-05T09:45:00Z',
    taskCount: 15,
  },
  {
    id: 'admin-1',
    name: '管理员',
    email: 'admin@example.com',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=admin',
    role: 'admin',
    status: 'active',
    createdAt: '2024-01-01T00:00:00Z',
    taskCount: 0,
  },
]

// 模拟AI对话历史
const mockAIChatHistory1: AIMessage[] = [
  {
    id: 'msg-1',
    role: 'system',
    content: '开始生成故事《星际迷途：最后的地球人》...',
    timestamp: '2024-03-15T10:00:00Z',
  },
  {
    id: 'msg-2',
    role: 'assistant',
    content: '正在构建故事大纲：\n1. 设定背景：公元3024年，地球毁灭后的宇宙\n2. 主角设定：最后一个纯正地球人类后裔\n3. 核心冲突：寻找传说中的新地球\n4. 情感线索：与AI伙伴的羁绊',
    timestamp: '2024-03-15T10:01:00Z',
    model: 'gpt-4o',
  },
  {
    id: 'msg-3',
    role: 'assistant',
    content: '第一章草稿已完成，正在进行润色...',
    timestamp: '2024-03-15T10:15:00Z',
    model: 'gpt-4o',
  },
  {
    id: 'msg-4',
    role: 'assistant',
    content: '全文初稿已完成，共计8562字。正在进行最终校对...',
    timestamp: '2024-03-15T12:20:00Z',
    model: 'gpt-4o',
  },
  {
    id: 'msg-5',
    role: 'system',
    content: '故事生成完成！总字数：8562字，用时：2小时30分钟',
    timestamp: '2024-03-15T12:30:00Z',
  },
]

const mockAIChatHistory2: AIMessage[] = [
  {
    id: 'msg-1',
    role: 'system',
    content: '开始生成故事《江湖夜雨十年灯》...',
    timestamp: '2024-03-16T09:00:00Z',
  },
  {
    id: 'msg-2',
    role: 'assistant',
    content: '正在构建武侠世界观...\n- 时代背景：南宋末年\n- 江湖势力：六大门派\n- 主角身份：隐世剑客',
    timestamp: '2024-03-16T09:02:00Z',
    model: 'claude-3-opus',
  },
  {
    id: 'msg-3',
    role: 'assistant',
    content: '第一章"雨夜惊变"撰写中...',
    timestamp: '2024-03-16T09:15:00Z',
    model: 'claude-3-opus',
  },
]

// 模拟任务数据 - 故事类型标题
export const mockTasks: WritingTask[] = [
  {
    id: 'task-1',
    userId: 'user-1',
    title: '星际迷途：最后的地球人',
    status: 'completed',
    progress: 100,
    wordCount: 8562,
    aiChatHistory: mockAIChatHistory1,
    content: `# 星际迷途：最后的地球人

## 第一章 沉睡千年

陈星从冷冻舱中醒来时,飞船的警报正在疯狂作响。

红色的警示灯在狭窄的舱室中闪烁,刺眼的光芒让他不得不眯起眼睛。他的身体僵硬得像一块冰,每一次呼吸都伴随着剧烈的疼痛。

"欢迎回来,陈星先生。"一个机械的女声在他耳边响起,"您已经沉睡了1247年3个月17天。"

陈星艰难地转动脖子,看向舱室角落的全息投影。一个蓝色的人形光影正静静地站在那里,那是飞船的AI管家——希娅。

"一千多年..."他的声音沙哑得几乎无法辨认,"地球...地球怎么样了?"

希娅沉默了三秒钟,这在AI来说是一个漫长得可怕的时间。

"地球已经不存在了,陈星先生。"

---

陈星花了整整三天才从冷冻休眠的副作用中完全恢复。在这三天里,希娅向他详细描述了人类文明在他沉睡期间发生的一切。

公元2847年,一颗来自奥尔特云的彗星撞击了地球。这颗被命名为"末日使者"的彗星直径超过50公里,撞击的瞬间,地球上的一切都灰飞烟灭。

在撞击发生前的三百年里,人类已经开始了大规模的星际移民计划。数以百万计的飞船载着人类的希望驶向宇宙深处,寻找新的家园。

而陈星所在的这艘飞船——"新希望号",是最后一批离开地球的船只之一。

"那么,其他的飞船呢?"陈星问道,"那些移民船队?"

"根据最后的通讯记录,大部分船队已经在不同的星系建立了殖民地。"希娅回答,"但由于通讯距离的限制,我们已经与他们失去了联系。"

陈星沉默地看着舷窗外的星空。在这片浩瀚无垠的宇宙中,他们就像一粒尘埃,孤独地漂浮着。

"希娅,我们现在在哪里?"

"我们正处于天琴座方向,距离最近的恒星系统约2.3光年。"

"燃料呢?"

"主反应堆燃料还剩余37%,足够我们进行三次超空间跳跃。"

陈星闭上眼睛,脑海中浮现出地球的样子——蓝色的海洋、绿色的大陆、白色的云层。那个美丽的星球,他再也回不去了。

但他不能就这样放弃。

"希娅,搜索所有可能存在人类殖民地的星系坐标。"

"遵命,陈星先生。"

---

## 第二章 星图之谜

在接下来的日子里,陈星和希娅一起分析了飞船数据库中所有关于人类殖民地的信息。

根据记录,在地球毁灭之前,人类已经在银河系的不同区域建立了七个主要殖民地。这些殖民地分别位于:

- 半人马座α星系（最近,已确认存在）
- 天苑四星系（农业殖民地）
- 巴纳德星系（矿业殖民地）
- 沃尔夫359星系（科研基地）
- 鲸鱼座τ星系（备选居住地）
- 波江座ε星系（军事基地）
- 天仓五星系（最远,实验性殖民地）

"以我们目前的燃料储量,我们只能到达其中三个星系。"希娅分析道,"我建议优先前往半人马座α星系,那里是最大的殖民地,也是人类联邦的首都所在地。"

陈星点了点头:"就这么定了。设定航线,准备跳跃。"

"需要提醒您的是,由于我们已经与人类联邦失去联系超过八百年,我们无法确定那里的现状。"

"我知道。"陈星深吸一口气,"但我们别无选择。"

---

当飞船从超空间跳跃中恢复正常航行时,陈星惊呆了。

在他面前,半人马座α星系的三颗恒星正散发着温暖的光芒。但让他震惊的不是这些恒星,而是环绕着其中一颗恒星运转的...残骸。

数以万计的飞船残骸漂浮在太空中,形成了一个巨大的碎片环带。这些残骸的设计风格各异,有些明显是人类制造的,而有些则完全陌生。

"希娅,这是怎么回事?"

AI沉默了很长时间才回答:"根据残骸分析,这里曾经发生过一场大规模的星际战争。时间推算...大约在600年前。"

"战争?和谁?"

"未知。"希娅的声音中带着一丝不安,"但根据残骸中检测到的能量特征,敌方使用的武器技术远超人类水平。"

陈星感到一阵寒意。人类在宇宙中并不孤独,但这个邻居似乎并不友好。

"继续扫描,看看有没有幸存者的信号。"

---

三天后,他们终于发现了一个微弱的信号。

信号来自一颗荒凉的行星——曾经被称为"新地球"的人类殖民地首都。陈星驾驶着小型穿梭机降落在这颗行星的表面,眼前的景象让他心如刀绞。

曾经繁华的城市如今只剩下断壁残垣。高耸的建筑变成了废墟,宽阔的街道被野草覆盖。这里曾经生活着数十亿人,如今却死一般寂静。

"生命信号源在前方500米处。"希娅的声音在他的头盔中响起。

陈星加快脚步,穿过一片片废墟,最终来到了一座半塌陷的建筑前。这里似乎是某种地下避难所的入口。

他推开沉重的金属门,顺着楼梯向下走去。黑暗中,他只能依靠头盔上的照明灯前进。

终于,他来到了一个巨大的地下空间。

而在这个空间的中央,站着一个人。

不,准确地说,是一个机器人。

它的外表和人类几乎完全一样,但陈星能够看出它身上那些精密的机械关节。这是一台高度拟人化的AI机器人。

"你好。"机器人开口说道,声音温和而有礼,"我等了很久了。"

陈星握紧了手中的武器:"你是谁?"

"我的名字是雅典娜。"机器人微微鸠躬,"我是人类联邦最后的守护者。而你..."它的目光落在陈星身上,"你是最后的地球人。"

---

*未完待续...*`,
    createdAt: '2024-03-15T10:00:00Z',
    updatedAt: '2024-03-15T12:30:00Z',
  },
  {
    id: 'task-2',
    userId: 'user-1',
    title: '江湖夜雨十年灯',
    status: 'processing',
    progress: 45,
    aiChatHistory: mockAIChatHistory2,
    createdAt: '2024-03-16T09:00:00Z',
    updatedAt: '2024-03-16T09:30:00Z',
  },
  {
    id: 'task-3',
    userId: 'user-1',
    title: '重生之都市仙尊',
    status: 'approved',
    progress: 100,
    wordCount: 12350,
    aiChatHistory: [
      { id: 'msg-1', role: 'system', content: '故事生成完成', timestamp: '2024-03-11T14:00:00Z' }
    ],
    content: '这是一篇关于都市修仙的故事...',
    createdAt: '2024-03-10T08:00:00Z',
    updatedAt: '2024-03-11T14:00:00Z',
    completedAt: '2024-03-11T14:00:00Z',
  },
  {
    id: 'task-4',
    userId: 'user-1',
    title: '末日游戏：我有无限复活',
    status: 'pending',
    progress: 0,
    createdAt: '2024-03-17T15:00:00Z',
    updatedAt: '2024-03-17T15:00:00Z',
  },
  {
    id: 'task-5',
    userId: 'user-1',
    title: '诸天万界聊天群',
    status: 'pending',
    progress: 0,
    createdAt: '2024-03-17T15:01:00Z',
    updatedAt: '2024-03-17T15:01:00Z',
  },
  {
    id: 'task-6',
    userId: 'user-2',
    title: '她在末世养神兽',
    status: 'completed',
    progress: 100,
    wordCount: 9800,
    aiChatHistory: [
      { id: 'msg-1', role: 'system', content: '开始生成故事...', timestamp: '2024-03-14T11:00:00Z' },
      { id: 'msg-2', role: 'assistant', content: '故事大纲已完成', timestamp: '2024-03-14T11:05:00Z', model: 'gpt-4o' },
      { id: 'msg-3', role: 'system', content: '故事生成完成！', timestamp: '2024-03-15T09:00:00Z' },
    ],
    content: '这是一篇关于末世养神兽的故事...',
    createdAt: '2024-03-14T11:00:00Z',
    updatedAt: '2024-03-15T09:00:00Z',
  },
  {
    id: 'task-7',
    userId: 'user-2',
    title: '我在古代开直播',
    status: 'rejected',
    progress: 100,
    wordCount: 6500,
    content: '这是一篇穿越直播的故事...',
    createdAt: '2024-03-12T10:00:00Z',
    updatedAt: '2024-03-13T16:00:00Z',
  },
  {
    id: 'task-8',
    userId: 'user-4',
    title: '全球高武：开局获得神级天赋',
    status: 'processing',
    progress: 78,
    aiChatHistory: [
      { id: 'msg-1', role: 'system', content: '开始生成故事...', timestamp: '2024-03-17T10:00:00Z' },
      { id: 'msg-2', role: 'assistant', content: '正在构建高武世界观...', timestamp: '2024-03-17T10:02:00Z', model: 'deepseek-v3' },
    ],
    createdAt: '2024-03-17T10:00:00Z',
    updatedAt: '2024-03-17T14:30:00Z',
  },
]

// 获取当前用户（模拟）
export function getCurrentUser(): User {
  return mockUsers[0] // 返回张三作为当前用户
}

// 获取当前用户的任务
export function getUserTasks(userId: string): WritingTask[] {
  return mockTasks.filter(task => task.userId === userId)
}

// 获取单个任务
export function getTask(taskId: string): WritingTask | undefined {
  return mockTasks.find(task => task.id === taskId)
}

// 获取所有用户（管理员用）
export function getAllUsers(): User[] {
  return mockUsers.filter(user => user.role === 'user')
}

// 获取用户详情
export function getUser(userId: string): User | undefined {
  return mockUsers.find(user => user.id === userId)
}
