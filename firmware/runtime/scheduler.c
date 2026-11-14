/**
 * author: Emilio Scott <milii76@outlook.com>,
 *		   Elias Santillan <emsantil@calpoly.edu>
 * date: 2026-11-13
 * file: scheduler.c
 */
#include "scheduler.h"

#include <stddef.h>

#include "pico/time.h"

/**
 * SCHED_MAX_TASKS - how many tasks sched_add() accepts
 *
 * override from CMake with -DSCHED_MAX_TASKS=n
 */
#ifndef SCHED_MAX_TASKS
#define SCHED_MAX_TASKS 16
#endif

/**
 * sched_slot_t - one registered task and when it runs next
 * @task: the caller's task, see sched_add()
 * @next_run: when @task is due next; ignored while @task->period_ms is 0
 *
 * kept here rather than in sched_task_func_t so the scheduler's bookkeeping
 * stays private to this file
 */
typedef struct sched_slot {
	sched_task_func_t *task;
	absolute_time_t next_run;
} sched_slot_t;

static sched_slot_t slots[SCHED_MAX_TASKS];
static int num_slots;

/**
 * wfe_until - default wait_until hook: sleep (WFE) until @until
 * @until: when the next task is due
 *
 * an interrupt or the other core's __sev() can wake it early.
 */
static void wfe_until(absolute_time_t until) { best_effort_wfe_or_timeout(until); }

static const sched_idle_t default_idle = {
	.poll = NULL,
	.wait_until = wfe_until,
};
static const sched_idle_t *idle = &default_idle;

/**
 * sched_add - register a task.
 * @task: the task to run; must stay valid while the scheduler runs
 *
 * the first run happens on the scheduler's next loop, then every
 * @task->period_ms after that. call from main before sched_run(), or from
 * inside a task; not safe from core 1 or an interrupt.
 *
 * return: 0 on success, -1 if the task list is full, @task or
 * @task->function is NULL, or @task is already registered.
 */
int sched_add(sched_task_func_t *task) {
	if (task == NULL || task->function == NULL || num_slots >= SCHED_MAX_TASKS)
		return -1;

	for (int i = 0; i < num_slots; i++) {
		if (slots[i].task == task)
			return -1;
	}

	slots[num_slots++] = (sched_slot_t){.task = task, .next_run = get_absolute_time()};
	return 0;
}

/**
 * run_due_tasks - run every task that is due, once
 *
 * periodic tasks are rescheduled from their due time, not from when they
 * finished, so they don't drift. a task that fell more than a period behind
 * skips the missed runs instead of running them back to back.
 *
 * return: when the next task is due; now if any task has period 0
 */
static absolute_time_t run_due_tasks(void) {
	absolute_time_t earliest = at_the_end_of_time;

	for (int i = 0; i < num_slots; i++) {
		sched_slot_t *slot = &slots[i];
		sched_task_func_t *task = slot->task;

		if (task->period_ms == 0) {
			task->function(task->ctx);
			earliest = get_absolute_time();
			continue;
		}

		if (time_reached(slot->next_run)) {
			task->function(task->ctx);
			slot->next_run = delayed_by_ms(slot->next_run, task->period_ms);
			if (time_reached(slot->next_run))
				slot->next_run = make_timeout_time_ms(task->period_ms);
		}

		earliest = absolute_time_min(earliest, slot->next_run);
	}

	return earliest;
}

/**
 * sched_set_idle - set the loop's poll and sleep hooks
 * @idle_hooks: the hooks; must stay valid while the scheduler runs
 *
 * return: 0 on success, -1 if @idle_hooks or @idle_hooks->wait_until is NULL.
 */
int sched_set_idle(const sched_idle_t *idle_hooks) {
	if (idle_hooks == NULL || idle_hooks->wait_until == NULL)
		return -1;

	idle = idle_hooks;
	return 0;
}

/**
 * sched_run - run the scheduler forever
 *
 * each loop calls the poll hook (e.g. cyw43_arch_poll()), runs the due
 * tasks, then sleeps through the wait_until hook until the next task is due.
 * with the cyw43 hooks the radio's interrupt wakes the core early when it
 * has work; the loop then just checks again. a task with period 0 keeps the
 * core awake.
 */
void sched_run(void) {
	for (;;) {
		if (idle->poll != NULL)
			idle->poll();

		absolute_time_t next = run_due_tasks();

		if (!time_reached(next))
			idle->wait_until(next);
	}
}
