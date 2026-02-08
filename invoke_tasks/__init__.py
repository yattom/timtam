import sys


class Logger:
    verbose = False

    def set_verbose(self, verbose):
        self.verbose = verbose

    def log(self, *args, **kwargs):
        if self.verbose:
            print(*args, **kwargs)

    def error(self, *args, **kwargs):
        print(*args, **kwargs, file=sys.stderr)

    def __call__(self, *args, **kwargs):
        self.log(*args, **kwargs)


log = Logger()


from .aws_operations import *
from .grasp_config import *
from .aws_resources import *

__all__ = [
    'log',
    'clear_dynamodb_table',
    'purge_sqs_queue',
    'seed_default_grasp_config',
]
