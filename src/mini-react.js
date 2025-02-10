/**
 * @file 简易 React 实现核心模块，包含虚拟 DOM、协调算法、状态管理和生命周期处理
 * 主要功能包括：
 * - 创建虚拟 DOM 结构
 * - Fiber 架构实现增量渲染
 * - 协调算法进行 DOM 差异更新
 * - 支持函数组件和类组件
 * - 实现 useState 和 useEffect 钩子
 */
// 最外面包一层函数，避免污染全局变量
(function () {
  /**
   * 创建虚拟 DOM 元素
   * @param {string|Function} type 元素类型
   * @param {Object|null} props 元素属性
   * @param {...any} children 子元素
   * @returns {Object} 虚拟 DOM 对象
   */
  function createElement(type, props, ...children) {
    return {
      type,
      props: {
        ...props,
        children: children.map((child) => {
          // 将原始文本内容转换为文本节点对象
          const isTextNode =
            typeof child === 'string' || typeof child === 'number';
          return isTextNode ? createTextNode(child) : child;
        }),
      },
    };
  }

  /**
   * 创建文本虚拟节点
   * - 单独处理文本节点是因为文本节点没有 type、children、props
   * - 需要给它加个固定的 type TEXT_ELEMENT，并且设置 nodeValue 的 props
   * - 这样结构统一，方便后面处理
   * @param {string|number} nodeValue 文本内容
   * @returns {Object} 文本节点对象
   */
  function createTextNode(nodeValue) {
    return {
      type: 'TEXT_ELEMENT',
      props: {
        nodeValue,
        children: [],
      },
    };
  }

  // Fiber 架构相关全局变量
  let nextUnitOfWork = null; // 下一个待处理的 Fiber 单元
  let wipRoot = null; // 当前工作中的 Fiber 树根节点
  let currentRoot = null; // 前一次提交的 Fiber 树根节点
  let deletions = null; // 待删除节点集合

  /**
   * 将虚拟 DOM 渲染到容器
   * @param {Object} element 虚拟 DOM 根元素
   * @param {HTMLElement} container DOM 容器元素
   */
  function render(element, container) {
    wipRoot = {
      dom: container,
      props: {
        children: [element],
      },
      alternate: currentRoot, // 连接前一次 Fiber 树用于 diff 比较
    };
    deletions = [];
    nextUnitOfWork = wipRoot;
  }

  /**
   * 主工作循环，配合浏览器空闲时间执行任务
   * @param {IdleDeadline} deadline 浏览器空闲时间信息
   */
  function workLoop(deadline) {
    let shouldYield = false;

    // 每次跑的时候判断下 timeRemaining 是否接近 0，是的话就中断循环，等下次 requestIdleCallback 的回调再继续处理 nextUnitOfWork 指向的 Fiber 节点
    while (nextUnitOfWork && !shouldYield) {
      nextUnitOfWork = performUnitOfWork(nextUnitOfWork);
      shouldYield = deadline.timeRemaining() < 1;
    }

    if (!nextUnitOfWork && wipRoot) {
      // 没有 nextUnitOfWork 且有正在处理的 Fiber 链表的根 wipRoot 的时候，也就是 reconcile 结束，开始执行 commit
      commitRoot();
    }

    // 用 requestIdleCallback 来代替 React 的时间分片，把 React Element 树转 Fiber 的 reconcile 过程放到不同的任务里跑
    requestIdleCallback(workLoop);
  }

  // 启动工作循环
  requestIdleCallback(workLoop);

  /**
   * 处理单个 Fiber 单元
   * @param {Object} fiber 当前处理的 Fiber 节点
   * @returns {Object|null} 下一个待处理的 Fiber 节点
   */
  function performUnitOfWork(fiber) {
    const isFunctionComponent = fiber.type instanceof Function;

    // 处理每个 Fiber 节点的时候，要根据类型做不同的处理
    if (isFunctionComponent) {
      updateFunctionComponent(fiber);
    } else {
      updateHostComponent(fiber);
    }

    // 构建 Fiber 遍历顺序：子节点 -> 兄弟节点 -> 父节点的兄弟节点
    // 处理完当前 Fiber 节点之后，会按照 child、sibling、return 的顺序返回下一个要处理的 Fiber 节点
    if (fiber.child) {
      return fiber.child;
    }
    let nextFiber = fiber;
    while (nextFiber) {
      if (nextFiber.sibling) {
        return nextFiber.sibling;
      }
      nextFiber = nextFiber.return;
    }
  }

  // 当前正在处理的 Fiber 节点和状态钩子索引
  let wipFiber = null;
  let stateHookIndex = null;

  /**
   * 更新函数组件
   * @param {Object} fiber 函数组件对应的 Fiber 节点
   */
  function updateFunctionComponent(fiber) {
    wipFiber = fiber;
    stateHookIndex = 0;
    wipFiber.stateHooks = []; // 存储 useState 的 hook 的值
    wipFiber.effectHooks = []; // 存储 useEffect 的 hook 的值

    // 执行函数组件获取子元素
    const children = [fiber.type(fiber.props)];
    reconcileChildren(fiber, children);
  }

  /**
   * 更新宿主组件（DOM 元素）
   * @param {Object} fiber 宿主组件对应的 Fiber 节点
   */
  function updateHostComponent(fiber) {
    if (!fiber.dom) {
      fiber.dom = createDom(fiber);
    }
    reconcileChildren(fiber, fiber.props.children);
  }

  /**
   * 创建实际 DOM 节点
   * @param {Object} fiber Fiber 节点
   * @returns {HTMLElement} 创建的 DOM 元素
   */
  function createDom(fiber) {
    // 根据不同节点类型用不同方式创建 DOM
    const dom =
      fiber.type === 'TEXT_ELEMENT'
        ? document.createTextNode('')
        : document.createElement(fiber.type);

    updateDom(dom, {}, fiber.props);
    return dom;
  }

  // DOM 属性更新辅助函数
  const isEvent = (key) => key.startsWith('on');
  const isProperty = (key) => key !== 'children' && !isEvent(key);
  const isNew = (prev, next) => (key) => prev[key] !== next[key];
  const isGone = (prev, next) => (key) => !(key in next);

  /**
   * 更新 DOM 属性
   * @param {HTMLElement} dom DOM 元素
   * @param {Object} prevProps 旧属性
   * @param {Object} nextProps 新属性
   */
  function updateDom(dom, prevProps, nextProps) {
    // 移除旧事件监听
    Object.keys(prevProps)
      .filter(isEvent)
      .filter((key) => !(key in nextProps) || isNew(prevProps, nextProps)(key))
      .forEach((name) => {
        const eventType = name.toLowerCase().substring(2);
        dom.removeEventListener(eventType, prevProps[name]);
      });

    // 移除旧属性
    Object.keys(prevProps)
      .filter(isProperty)
      .filter(isGone(prevProps, nextProps))
      .forEach((name) => {
        dom[name] = '';
      });

    // 设置新属性
    Object.keys(nextProps)
      .filter(isProperty)
      .filter(isNew(prevProps, nextProps))
      .forEach((name) => {
        dom[name] = nextProps[name];
      });

    // 添加新事件监听
    Object.keys(nextProps)
      .filter(isEvent)
      .filter(isNew(prevProps, nextProps))
      .forEach((name) => {
        const eventType = name.toLowerCase().substring(2);
        dom.addEventListener(eventType, nextProps[name]);
      });
  }

  /**
   * 协调子元素，生成 Fiber 链表（Diff 算法核心）
   * @param {Object} wipFiber 当前 Fiber 节点
   * @param {Array} elements 子元素数组
   */
  function reconcileChildren(wipFiber, elements) {
    let index = 0; // 记录同层中元素的位置
    let oldFiber = wipFiber.alternate?.child; // 拿到旧 Fiber
    let prevSibling = null; // 记录创建好的最新的 Fiber，用于构建 Fiber 树

    // 遍历新旧子节点进行对比
    while (index < elements.length || oldFiber != null) {
      const element = elements[index];
      let newFiber = null;

      // Diff 比较三种情况
      const sameType = element?.type === oldFiber?.type;

      if (sameType) {
        // 类型相同：更新属性
        newFiber = {
          type: oldFiber.type,
          props: element.props,
          dom: oldFiber.dom,
          return: wipFiber,
          alternate: oldFiber,
          effectTag: 'UPDATE',
        };
      }
      if (element && !sameType) {
        // 类型不同且存在新元素：创建新节点
        newFiber = {
          type: element.type,
          props: element.props,
          dom: null,
          return: wipFiber,
          alternate: null,
          effectTag: 'PLACEMENT',
        };
      }
      if (oldFiber && !sameType) {
        // 类型不同且存在旧元素：标记删除
        oldFiber.effectTag = 'DELETION';
        deletions.push(oldFiber);
      }

      if (oldFiber) {
        // 依次取 sibling，逐一和新的 Fiber 节点对比
        oldFiber = oldFiber.sibling;
      }

      // 构建 Fiber 链表
      if (index === 0) {
        // 如果新创建的 Fiber 是当前层的第一个元素，则作为上一层（此时保存在 wipFiber）的 child 保存
        wipFiber.child = newFiber;
      } else if (element) {
        // 同层的非第一个元素，均以 sibling 相连
        prevSibling.sibling = newFiber;
      }

      // 记录创建好的最新的 Fiber
      prevSibling = newFiber;
      index++; // 递增位置信息
    }
  }

  /**
   * 状态钩子（useState 实现）
   * @param {any} initialState 初始状态
   * @returns {[any, Function]} 状态和更新函数
   */
  function useState(initialState) {
    const currentFiber = wipFiber;

    // 在 Fiber 节点上用 stateHooks 数组来存储 state 和多次调用 setState 的回调函数
    const oldHook = wipFiber.alternate?.stateHooks?.[stateHookIndex];

    const stateHook = {
      // 保存 state，如果前一次渲染的 stateHooks 的同一位置有值，则用上次渲染的值做初始化
      state: oldHook ? oldHook.state : initialState,
      // 多次调用 setState 的回调函数队列
      queue: oldHook ? oldHook.queue : [],
    };

    // 处理队列中的状态更新。如果调用列表里有多次调用，这样对初始 state 执行多个 action（也就是 setState） 之后，就能拿到最终的 state 值
    stateHook.queue.forEach((action) => {
      stateHook.state = action(stateHook.state);
    });

    // 修改完 state 之后清空 queue
    stateHook.queue = [];

    stateHookIndex++;
    // 每次调用 useState 时会在 stateHooks 中保存 state
    wipFiber.stateHooks.push(stateHook);

    const setState = (action) => {
      const isFunction = typeof action === 'function';

      // setState 实际上是在 action 数组里添加新的 action
      stateHook.queue.push(isFunction ? action : () => action);

      // 触发重新渲染
      wipRoot = {
        ...currentFiber,
        alternate: currentFiber,
      };
      // 让 nextUnitOfWork 指向新的 wipRoot，从而开始新的一轮渲染
      nextUnitOfWork = wipRoot;
    };

    return [stateHook.state, setState];
  }

  /**
   * 副作用钩子（useEffect 实现）
   * @param {Function} callback 副作用回调
   * @param {Array} deps 依赖数组
   */
  function useEffect(callback, deps) {
    // useEffect 本质上是在 fiber.effectHooks 上添加一个元素
    // 在 commit 阶段遍历这个构建好的 fiber 链表，会执行增删改和 effect 函数
    wipFiber.effectHooks.push({
      callback,
      deps,
      cleanup: undefined,
    });
  }

  /**
   * 提交所有变更到 DOM
   */
  function commitRoot() {
    // commit 阶段先把需要删除的节点都删掉
    deletions.forEach(commitWork);

    // 然后遍历 fiber 链表，处理其它节点
    commitWork(wipRoot.child);

    // 然后处理 effect 逻辑
    commitEffectHooks();

    // 所有操作处理完后，把当前 wipRoot 设置为 currentRoot，然后把 wipRoot、deletions 初始化，这就代表这次 reconcile 结束了
    currentRoot = wipRoot;
    wipRoot = null;
    deletions = [];
  }

  /**
   * 递归提交单个 Fiber 变更
   * @param {Object|null} fiber 当前处理的 Fiber 节点
   */
  function commitWork(fiber) {
    // commitWork 按照 child、sibling 的顺序来递归遍历 fiber 链表，直到没有 fiber 后退出递归
    if (!fiber) return;

    // 查找最近的 DOM 父节点
    let domParentFiber = fiber.return;
    while (!domParentFiber.dom) {
      // 如果没有 DOM 就不断向上找，直到找到可以挂载的 DOM 节点
      domParentFiber = domParentFiber.return;
    }
    const domParent = domParentFiber.dom;

    // 处理不同类型的变更，按照之前标记的 effectTag 来处理
    if (fiber.effectTag === 'PLACEMENT' && fiber.dom != null) {
      domParent.appendChild(fiber.dom);
    } else if (fiber.effectTag === 'UPDATE' && fiber.dom != null) {
      updateDom(fiber.dom, fiber.alternate.props, fiber.props);
    } else if (fiber.effectTag === 'DELETION') {
      commitDeletion(fiber, domParent);
    }

    commitWork(fiber.child);
    commitWork(fiber.sibling);
  }

  /**
   * 递归删除 DOM 节点
   * @param {Object} fiber 要删除的 Fiber 节点
   * @param {HTMLElement} domParent 父 DOM 元素
   */
  function commitDeletion(fiber, domParent) {
    if (fiber.dom) {
      domParent.removeChild(fiber.dom);
    } else {
      // 如果当前 fiber 节点没有对应的 dom，就不断沿 child 向下找
      commitDeletion(fiber.child, domParent);
    }
  }

  /**
   * 执行副作用钩子的清理和回调
   */
  function commitEffectHooks() {
    // 执行清理函数
    function runCleanup(fiber) {
      if (!fiber) return;

      fiber.alternate?.effectHooks?.forEach((hook, index) => {
        const deps = fiber.effectHooks[index].deps;

        // 当没有传入 deps 数组，或者 deps 数组和上次不一致时，就执行 cleanup 函数
        if (!hook.deps || !isDepsEqual(hook.deps, deps)) {
          hook.cleanup?.();
        }
      });

      runCleanup(fiber.child);
      runCleanup(fiber.sibling);
    }

    // 执行副作用回调
    function run(fiber) {
      if (!fiber) return;

      fiber.effectHooks?.forEach((newHook, index) => {
        const oldHook = fiber.alternate?.effectHooks?.[index];

        if (!oldHook) {
          // 没有 alternate 的时候，即首次渲染，直接执行所有的 effect
          newHook.cleanup = newHook.callback();
        } else if (!isDepsEqual(oldHook.deps, newHook.deps)) {
          // 依赖变化时执行
          oldHook.cleanup?.();
          newHook.cleanup = newHook.callback();
        }
      });

      run(fiber.child);
      run(fiber.sibling);
    }

    // 先遍历一遍执行所有的 cleanup 函数
    runCleanup(wipRoot);
    // 然后再次遍历执行 effect 函数
    run(wipRoot);
  }

  // 依赖比较辅助函数
  function isDepsEqual(deps, newDeps) {
    return (
      deps.length === newDeps.length &&
      deps.every((dep, i) => dep === newDeps[i])
    );
  }

  // 暴露 API 到全局
  const MiniReact = {
    createElement,
    render,
    useState,
    useEffect,
  };

  window.MiniReact = MiniReact;
})();
