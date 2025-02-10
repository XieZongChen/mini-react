// 最外面包一层函数，避免污染全局变量
(function () {
  function createElement(type, props, ...children) {
    return {
      type,
      props: {
        ...props,
        children: children.map((child) => {
          const isTextNode =
            typeof child === 'string' || typeof child === 'number';
          return isTextNode ? createTextNode(child) : child;
        }),
      },
    };
  }

  /**
   * 处理文本节点
   * - 单独处理文本节点是因为文本节点是没有 type、children、props 的
   * - 需要给它加个固定的 type TEXT_ELEMENT，并且设置 nodeValue 的 props
   * - 这样结构统一，方便后面处理
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

  let nextUnitOfWork = null; // 指向下一个要处理的 fiber 节点
  let wipRoot = null; // 当前正在处理的 fiber 链表的根 wipRoot
  let currentRoot = null; // 之前的历史 fiber 链表的根 currentRoot
  let deletions = null; // 记录要删除的节点

  function render(element, container) {
    wipRoot = {
      dom: container,
      props: {
        children: [element],
      },
      alternate: currentRoot, // 存在这里在后续 diff 时使用
    };

    // 初始化 deletions
    deletions = [];

    // 设置初始 nextUnitOfWork
    nextUnitOfWork = wipRoot;
  }

  function workLoop(deadline) {
    let shouldYield = false;
    // 每次跑的时候判断下 timeRemaining 是否接近 0，是的话就中断循环，等下次 requestIdleCallback 的回调再继续处理 nextUnitOfWork 指向的 fiber 节点
    while (nextUnitOfWork && !shouldYield) {
      nextUnitOfWork = performUnitOfWork(nextUnitOfWork);
      shouldYield = deadline.timeRemaining() < 1;
    }

    if (!nextUnitOfWork && wipRoot) {
      // 没有 nextUnitOfWork 且有正在处理的 fiber 链表的根 wipRoot 的时候，也就是 reconcile 结束，开始执行 commit
      commitRoot();
    }

    // 用 requestIdleCallback 来代替 React 的时间分片，把 React Element 树转 fiber 的 reconcile 过程放到不同的任务里跑
    requestIdleCallback(workLoop);
  }

  requestIdleCallback(workLoop);

  function performUnitOfWork(fiber) {
    const isFunctionComponent = fiber.type instanceof Function;
    // 处理每个 fiber 节点的时候，要根据类型做不同的处理
    if (isFunctionComponent) {
      updateFunctionComponent(fiber);
    } else {
      updateHostComponent(fiber);
    }

    // 处理每个 fiber 节点之后，会按照 child、sibling、return 的顺序返回下一个要处理的 fiber 节点
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

  let wipFiber = null; // 指向当前处理的 fiber
  let stateHookIndex = null;

  /**
   * 函数组件处理
   */
  function updateFunctionComponent(fiber) {
    wipFiber = fiber;
    stateHookIndex = 0;
    wipFiber.stateHooks = []; // 存储 useState 的 hook 的值
    wipFiber.effectHooks = []; // 存储 useEffect 的 hook 的值

    const children = [fiber.type(fiber.props)];
    reconcileChildren(fiber, children);
  }

  /**
   * 原生标签处理
   */
  function updateHostComponent(fiber) {
    if (!fiber.dom) {
      fiber.dom = createDom(fiber);
    }
    reconcileChildren(fiber, fiber.props.children);
  }

  /**
   * 创建 dom
   */
  function createDom(fiber) {
    // 根据不同节点类型用不同方式创建 dom
    const dom =
      fiber.type == 'TEXT_ELEMENT'
        ? document.createTextNode('')
        : document.createElement(fiber.type);

    updateDom(dom, {}, fiber.props);

    return dom;
  }

  const isEvent = (key) => key.startsWith('on'); // 是否是事件
  const isProperty = (key) => key !== 'children' && !isEvent(key); // 是否是属性
  const isNew = (prev, next) => (key) => prev[key] !== next[key]; // 是否是新的
  const isGone = (prev, next) => (key) => !(key in next); // 是否是删除的

  /**
   * 更新 dom
   * - 主要是更新 dom 上的 props，包括属性和事件
   */
  function updateDom(dom, prevProps, nextProps) {
    // 删除旧的或有更改的 event listeners
    Object.keys(prevProps)
      .filter(isEvent)
      .filter((key) => !(key in nextProps) || isNew(prevProps, nextProps)(key))
      .forEach((name) => {
        const eventType = name.toLowerCase().substring(2);
        dom.removeEventListener(eventType, prevProps[name]);
      });

    // 删除旧 properties
    Object.keys(prevProps)
      .filter(isProperty)
      .filter(isGone(prevProps, nextProps))
      .forEach((name) => {
        dom[name] = '';
      });

    // 设置新的或者有更改的 properties
    Object.keys(nextProps)
      .filter(isProperty)
      .filter(isNew(prevProps, nextProps))
      .forEach((name) => {
        dom[name] = nextProps[name];
      });

    // 添加 event listeners
    Object.keys(nextProps)
      .filter(isEvent)
      .filter(isNew(prevProps, nextProps))
      .forEach((name) => {
        const eventType = name.toLowerCase().substring(2);
        dom.addEventListener(eventType, nextProps[name]);
      });
  }

  function reconcileChildren(wipFiber, elements) {
    let index = 0; // 记录同层中元素的位置
    let oldFiber = wipFiber.alternate?.child; // 拿到旧 fiber 用于 diff
    let prevSibling = null; // 记录创建好的最新的 fiber，用于链接 fiber 树

    while (index < elements.length || oldFiber != null) {
      const element = elements[index];
      let newFiber = null;

      // 判断节点 type 是不是一样
      const sameType = element?.type == oldFiber?.type;

      if (sameType) {
        // 节点 type 一样说明是更新
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
        // 节点 type 不一样但存在 element，说明是新增
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
        // 节点 type 不一样 + 没有 element + 存在旧 fiber，说明是删除
        oldFiber.effectTag = 'DELETION';
        deletions.push(oldFiber);
      }

      if (oldFiber) {
        // 依次取 sibling，逐一和新的 fiber 节点对比
        oldFiber = oldFiber.sibling;
      }

      if (index === 0) {
        // 如果新创建的 fiber 是当前层的第一个元素，则作为上一层（此时保存在 wipFiber）的 child 保存
        wipFiber.child = newFiber;
      } else if (element) {
        // 同层的非第一个元素，均已 sibling 相连
        prevSibling.sibling = newFiber;
      }

      // 记录创建好的最新的 fiber
      prevSibling = newFiber;
      index++; // 递增位置信息
    }
  }

  function useState(initialState) {
    const currentFiber = wipFiber;

    // 在 fiber 节点上用 stateHooks 数组来存储 state 和多次调用 setState 的回调函数
    const oldHook = wipFiber.alternate?.stateHooks[stateHookIndex];

    const stateHook = {
      state: oldHook ? oldHook.state : initialState, // 保存 state，如果前一次渲染的 stateHooks 的同一位置有值，则用上次渲染的值做初始化
      queue: oldHook ? oldHook.queue : [], // 多次调用 setState 的回调函数队列
    };

    // 如果调用列表里有多次调用，这样对初始 state 执行多个 action（也就是 setState） 之后，就拿到了最终的 state 值
    stateHook.queue.forEach((action) => {
      stateHook.state = action(stateHook.state);
    });

    // 修改完 state 之后清空 queue
    stateHook.queue = [];

    stateHookIndex++;
    // 每次调用 useState 时会在 stateHooks 添加一个元素来保存 state
    wipFiber.stateHooks.push(stateHook);

    function setState(action) {
      const isFunction = typeof action === 'function';

      // setState 就是在 action 数组里添加新的 action
      stateHook.queue.push(isFunction ? action : () => action);

      wipRoot = {
        ...currentFiber,
        alternate: currentFiber,
      };
      // 让 nextUnitOfWork 指向新的 wipRoot，从而开始新的一轮渲染
      nextUnitOfWork = wipRoot;
    }

    return [stateHook.state, setState];
  }

  function useEffect(callback, deps) {
    const effectHook = {
      callback,
      deps,
      cleanup: undefined,
    };
    // useEffect 本质上是在 fiber.effectHooks 上添加一个元素
    // 这样等 reconcile 结束，fiber 链表就构建好了，在 fiber 上打上了增删改的标记，并且也保存了要执行的 effect
    // 在 commit 阶段遍历这个构建好的 fiber 链表，会执行增删改和 effect 函数
    wipFiber.effectHooks.push(effectHook);
  }

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

  function commitWork(fiber) {
    // commitWork 按照 child、sibling 的顺序来递归遍历 fiber 链表，直到没有 fiber 后退出递归
    if (!fiber) {
      return;
    }

    let domParentFiber = fiber.return;
    while (!domParentFiber.dom) {
      // 不断向上找，找到可以挂载的 dom 节点
      domParentFiber = domParentFiber.return;
    }
    const domParent = domParentFiber.dom;

    // 按照之前标记的 effectTag 来处理 dom
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

  function commitDeletion(fiber, domParent) {
    // 删除的时候，如果当前 fiber 节点没有对应的 dom，就不断 child 向下找
    if (fiber.dom) {
      domParent.removeChild(fiber.dom);
    } else {
      commitDeletion(fiber.child, domParent);
    }
  }

  function isDepsEqual(deps, newDeps) {
    if (deps.length !== newDeps.length) {
      return false;
    }

    for (let i = 0; i < deps.length; i++) {
      if (deps[i] !== newDeps[i]) {
        return false;
      }
    }
    return true;
  }

  function commitEffectHooks() {
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

    function run(fiber) {
      if (!fiber) return;

      fiber.effectHooks?.forEach((newHook, index) => {
        if (!fiber.alternate) {
          // 当没有 alternate 的时候，就是首次渲染，直接执行所有的 effect
          newHook.cleanup = newHook.callback();
          return;
        }

        if (!newHook.deps) {
          newHook.cleanup = newHook.callback();
        }

        if (newHook.deps.length > 0) {
          const oldHook = fiber.alternate?.effectHooks[index];

          if (!isDepsEqual(oldHook.deps, newHook.deps)) {
            newHook.cleanup = newHook.callback();
          }
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

  const MiniReact = {
    createElement,
    render,
    useState,
    useEffect,
  };

  window.MiniReact = MiniReact;
})();
