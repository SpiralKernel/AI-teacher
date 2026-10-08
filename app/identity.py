"""请求作用域身份；维护脚本与显式单用户测试使用旧 demo 身份。"""
from contextvars import ContextVar

current = ContextVar('student_identity', default=None)


def student_id():
    value = current.get()
    return value['student_id'] if value else 'demo'


def scope():
    return current.get()


def book_id():
    value = scope()
    return f"math-{value['grade']}-{value['term']}" if value else 'math-7-1'
