package kjd.reactnative.bluetooth

import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.ThreadFactory
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

internal fun interface Cancellable {
  fun cancel()
}

/** Runs delayed actions for timeouts and batching. Tests replace it with a clock they advance by hand. */
internal interface Scheduler {
  fun schedule(delayMs: Long, action: Runnable): Cancellable

  fun shutdown() {}
}

/** A [Scheduler] backed by one daemon thread. */
internal class ExecutorScheduler(name: String) : Scheduler {
  private val executor =
    ScheduledThreadPoolExecutor(1, daemonThreads(name)).apply { removeOnCancelPolicy = true }

  override fun schedule(delayMs: Long, action: Runnable): Cancellable {
    val future =
      executor.schedule(
        {
          try {
            action.run()
          } catch (t: Throwable) {
            Logger.error("A scheduled action threw", t)
          }
        },
        delayMs,
        TimeUnit.MILLISECONDS
      )
    return Cancellable { future.cancel(false) }
  }

  override fun shutdown() {
    executor.shutdownNow()
  }
}

/** Names threads `<prefix>-<n>` and marks them as daemons, so they never keep the process alive. */
internal fun daemonThreads(prefix: String): ThreadFactory {
  val count = AtomicInteger()
  return ThreadFactory { runnable ->
    Thread(runnable, "$prefix-${count.incrementAndGet()}").apply { isDaemon = true }
  }
}
