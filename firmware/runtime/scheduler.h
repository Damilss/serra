/**
 * author: Emilio Scott <milii76@outlook.com>,
 *		   Elias Santillan <emsantil@calpoly.edu>
 * date: 2026-11-13
 * file: scheduler.h
 */
#ifndef RUNTIME_SCHEDULER_H
#define RUNTIME_SCHEDULER_H
#include <stdint.h>

/**
 * sched_func_t - a task's body; called with the task's @ctx each time it runs
 */
typedef void (*sched_func_t)(void *ctx);

/**
 * sched_task_func_t - struct for our task for the scheduler
 * @name: label for logs for debugging purposes
 * @function: called ever @period_ms milliseconds
 * @ctx: passed to @function, context
 * @period_ms: how owten to run; 0 = run on every loop of scheduler
 *
 * aliased as sched_task_func_t, the scheduler keeps a pointer to the task,
 * so it must outlive the scheduler, static or global storage
 */
typedef struct sched_task_func {
	const char *name;
	sched_func_t function;
	void *ctx;
	uint32_t period_ms;

}sched_task_func_t;

/**
 * sched_add - register a task.
 *
 * return: 0 on succes, -1 if the task is full or @task->function is NULL.
 */
int sched_add(sched_task_func_t *task);

/**
 * sched_run - the runner that will actived the schedulers, runs forever
 */
void sched_run(void);

#endif /* RUNTIME_SCHEDULER_H */
